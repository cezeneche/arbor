#!/usr/bin/env node
//
// Seal the Nucleos CBAM audit chain and record it in Arbor. Rollout step 8.
//
// Arbor's chain is the only one accepting writes now. Nucleos's was not imported
// — none of its entries backed a filed declaration or was shown to a supplier or
// auditor, and its cases were sample data. But a chain that stops with no record
// of where it stopped is indistinguishable from one that was truncated, and
// "entries are missing" is the accusation this system exists to answer. So its
// final state is committed as the origin marker of Arbor's chain.
//
// Nothing here reimplements anything:
//
//   the seal hash    comes from nucleos/api/ledger_app/services/chain_seal.py
//   the write guard  comes from src/lib/audit/foreign-chain-seal.ts
//
// Both are compiled/invoked as they are. A second copy of either would be a
// second answer to "what was the final state", and the whole point of a seal is
// that there is exactly one.
//
// Usage:
//   NUCLEOS_DATABASE_URL=... npm run seal:nucleos            (DATABASE_URL comes from .env)
//   NUCLEOS_DATABASE_URL=... npm run seal:nucleos -- --dry-run
//
// Idempotent: re-running with an identical chain returns the existing seal.
// Re-running after the chain has changed refuses, loudly.

// Loads DATABASE_URL from .env so only the Nucleos URL has to be supplied by
// hand. Does not override anything already set in the environment.
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const REPO = path.resolve(import.meta.dirname, '..')
const DRY_RUN = process.argv.includes('--dry-run')
const ORIGIN = 'nucleos.cbam.audit_log'

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

const nucleosUrl = process.env.NUCLEOS_DATABASE_URL
const arborUrl = process.env.DATABASE_URL
if (!nucleosUrl) fail('NUCLEOS_DATABASE_URL is not set. It is the database the chain lives in.')
if (!arborUrl && !DRY_RUN) fail('DATABASE_URL is not set. It is where the seal is recorded.')

// ── 1. Read the chain, in the order it was written ──────────────────────────
// Ordering is part of what the seal commits to, so this is the same ORDER BY the
// verifier uses. Reading it any other way would produce a different hash for the
// same chain.

console.log(`\n  Reading ${ORIGIN}…`)
const client = new pg.Client({ connectionString: nucleosUrl })
await client.connect()
let rows
try {
  const res = await client.query(
    `SELECT id, case_id, event_type, actor, payload, signature, chain_hash, created_at
     FROM cbam.audit_log
     ORDER BY created_at ASC`,
  )
  rows = res.rows
} finally {
  await client.end()
}

const signed = rows.filter(r => r.signature)
console.log(`  ${rows.length} entries, ${signed.length} signed.`)

if (rows.length === 0) {
  // Sealing nothing would assert the chain was empty, which is a claim about
  // history. An empty read is far more likely to mean the wrong database.
  fail(
    'The chain is empty. Sealing that would assert Nucleos never wrote an audit ' +
      'entry — check NUCLEOS_DATABASE_URL points at the Nucleos database.',
  )
}

// ── 2. Compute the seal with Nucleos's own implementation ───────────────────

const payload = JSON.stringify(
  rows.map(r => ({
    ...r,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  })),
)

let seal
try {
  const out = execFileSync(
    'python3',
    [
      '-c',
      [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'nucleos/api'))})`,
        'from ledger_app.services.chain_seal import compute_chain_seal',
        'rows = json.load(sys.stdin)',
        `seal = compute_chain_seal(rows, origin=${JSON.stringify(ORIGIN)})`,
        'print(json.dumps(seal.to_dict()))',
      ].join('\n'),
    ],
    { input: payload, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  seal = JSON.parse(out.trim().split('\n').pop())
} catch (err) {
  fail(`Could not compute the seal with Nucleos's implementation: ${err.message}`)
}

console.log(`\n  origin           ${seal.origin}`)
console.log(`  algorithm        ${seal.algorithm}`)
console.log(`  entries          ${seal.entry_count}`)
console.log(`  first event      ${seal.first_event_at ?? '—'}`)
console.log(`  last event       ${seal.last_event_at ?? '—'}`)
console.log(`  final signature  ${seal.final_signature ? seal.final_signature.slice(0, 24) + '…' : '—'}`)
console.log(`  seal hash        ${seal.seal_hash}`)

if (DRY_RUN) {
  console.log('\n  --dry-run: nothing was written.\n')
  process.exit(0)
}

// ── 3. Record it in Arbor, through Arbor's own guard ────────────────────────
// The guard refuses to overwrite a differing seal. Compiling the real module is
// how that refusal stays the one that ships, rather than one written for a script.

// Built inside the repo, not in the system temp dir: tsc resolves @prisma/client
// by walking up to node_modules, and from /var/folders it never finds it.
const outDir = mkdtempSync(path.join(REPO, '.seal-build-'))
mkdirSync(path.join(outDir, 'src', 'lib', 'audit'), { recursive: true })

const sealSrc = readFileSync(path.join(REPO, 'src/lib/audit/foreign-chain-seal.ts'), 'utf8')
writeFileSync(
  path.join(outDir, 'src/lib/audit/foreign-chain-seal.ts'),
  // The one path alias, made relative. Mechanical, and the only edit made.
  sealSrc.replace("from '@/lib/prisma'", "from '../prisma'"),
)
writeFileSync(
  path.join(outDir, 'src/lib/prisma.ts'),
  readFileSync(path.join(REPO, 'src/lib/prisma.ts'), 'utf8'),
)

execFileSync(
  path.join(REPO, 'node_modules/.bin/tsc'),
  [
    path.join(outDir, 'src/lib/audit/foreign-chain-seal.ts'),
    '--outDir', path.join(outDir, 'out'),
    // Pinned, not inferred. tsc otherwise derives rootDir from the common source
    // directory, which moves the output path when the set of files changes.
    '--rootDir', path.join(outDir, 'src'),
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: REPO, stdio: 'inherit' },
)

const require_ = createRequire(import.meta.url)
const { recordForeignChainSeal, NUCLEOS_SEAL_REASON } = require_(
  path.join(outDir, 'out/lib/audit/foreign-chain-seal.js'),
)

try {
  const recorded = await recordForeignChainSeal({
    origin: seal.origin,
    algorithm: seal.algorithm,
    entryCount: seal.entry_count,
    firstEventAt: seal.first_event_at,
    lastEventAt: seal.last_event_at,
    finalSignature: seal.final_signature,
    sealHash: seal.seal_hash,
    sealedAt: seal.sealed_at,
    importedIntoArbor: false,
    reason: NUCLEOS_SEAL_REASON,
  })
  const fresh = recorded.sealHash === seal.seal_hash && recorded.createdAt
  console.log(`\n  ✓ Sealed and recorded in Arbor (id ${recorded.id}).`)
  if (fresh) console.log('    Re-running this with the same chain is safe.\n')
} catch (err) {
  if (err?.name === 'ChainAlreadySealedError') {
    fail(
      `${err.message}\n\n    The chain has changed since it was sealed. That is worth ` +
        `understanding before doing anything else.`,
    )
  }
  fail(`Could not record the seal: ${err.message}`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

process.exit(0)
