#!/usr/bin/env node
// Prove the Arbor ↔ Nucleos boundary end to end, locally.
//
// Every test on either side of this boundary uses a fake. Arbor's client is
// tested against a stub fetch; Nucleos's endpoints are tested with a Python
// TestClient. Neither proves the two agree — a field renamed on one side, a
// constraint enforced on only one, or a serialisation difference would pass both
// suites and fail the first time they actually spoke.
//
// This boots the real Nucleos service, points Arbor's real client at it over
// real HTTP, and checks the round trip. It needs no deployment and no cloud
// account, which is only true because both sides now live in one repo.
//
//   node scripts/verify-boundary.mjs
//
// Exits non-zero on the first disagreement.

import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT as REPO, requireVenvBin } from './python-env.mjs'

const PORT = Number(process.env.BOUNDARY_PORT ?? 8931)
const BASE = `http://127.0.0.1:${PORT}`

// Resolved from the repo or an explicit NUCLEOS_VENV — never from a personal
// path. The second candidate here used to be a home directory, which made this
// check unrunnable on any other machine.
const venv = requireVenvBin()

const ENV = {
  ...process.env,
  DATABASE_URL: 'sqlite:///./boundary_check.db',
  JWT_SECRET: 'test-jwt-secret-for-testing-only-32b',
  JWT_ISSUER: 'scope3-agentic',
  JWT_AUDIENCE: 'scope3-clients',
  AUDIT_SIGNING_KEY: 'boundary-check-audit-signing-key-distinct',
  FIELD_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  AUTH_DEV_TOKEN_ENDPOINT: 'true',
  // No ANTHROPIC_API_KEY: the extractor falls back to its deterministic layer,
  // which is what makes this check reproducible.
  ANTHROPIC_API_KEY: '',
}

const results = []
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail && !condition ? ` — ${detail}` : ''}`)
}

const INVOICE = `COMMERCIAL INVOICE

Seller: Borusan Mannesmann Boru Sanayi ve Ticaret A.S.
Buyer:  Northern Steel Stockholders Ltd
        EORI: GB123456789000

Invoice number: INV-2027-0042
Invoice date: 2027-02-14
Country of origin: TR
Incoterm: CIF Immingham
Customs entry reference: 24GB12345678901234

CN code: 72071111
Net mass: 24,500.00 kg
Direct embedded emissions: 44100 kgCO2e
Method: actual
`

async function waitForReady(proc) {
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode !== null) throw new Error(`Nucleos exited early (code ${proc.exitCode})`)
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('Nucleos did not become ready within 60s')
}

async function mintToken(scopes = ['cbam:read', 'cbam:write']) {
  const res = await fetch(`${BASE}/api/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub: 'boundary-check', tenant_id: 'boundary', scopes }),
  })
  if (!res.ok) throw new Error(`Could not mint a dev token: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.access_token ?? body.token
}

const server = spawn(
  path.join(venv, 'python'),
  ['-m', 'uvicorn', 'main:app', '--app-dir', 'api', '--host', '127.0.0.1', '--port', String(PORT), '--log-level', 'warning'],
  { cwd: path.join(REPO, 'nucleos'), env: ENV, stdio: ['ignore', 'pipe', 'pipe'] },
)
let serverLog = ''
server.stdout.on('data', d => { serverLog += d })
server.stderr.on('data', d => { serverLog += d })

let exitCode = 0
try {
  console.log(`Booting Nucleos on ${BASE} …`)
  await waitForReady(server)
  console.log('Nucleos is up.\n')

  const token = await mintToken()
  process.env.NUCLEOS_URL = BASE
  process.env.NUCLEOS_INTERNAL_TOKEN = token

  // Arbor's real client, compiled with the repo's own TypeScript — the same
  // modules the Inngest pipeline calls. Compiled rather than reimplemented in
  // JS, because a hand-written stand-in would test the stand-in.
  // Inside the repo, so the compiled clients resolve their dependencies (such
  // as @vercel/oidc) from its node_modules, as they do in the app.
  const cacheDir = path.join(REPO, 'node_modules/.cache')
  mkdirSync(cacheDir, { recursive: true })
  const outDir = mkdtempSync(path.join(cacheDir, 'arbor-boundary-'))
  process.on('exit', () => rmSync(outDir, { recursive: true, force: true }))
  execFileSync(
    path.join(REPO, 'node_modules/.bin/tsc'),
    [
      'src/lib/nucleos/extraction-client.ts',
      'src/lib/nucleos/field-mapper.ts',
      'src/lib/nucleos/supplier-form-client.ts',
      'src/lib/nucleos/scope-client.ts',
      'src/lib/nucleos/verification-client.ts',
      'src/lib/nucleos/case-evidence.ts',
      'src/lib/nucleos/explain-client.ts',
      'src/lib/nucleos/relief-client.ts',
      'src/lib/nucleos/supplier-history-client.ts',
      'src/lib/nucleos/supplier-history-presenter.ts',
      'src/lib/nucleos/narrative-client.ts',
      '--outDir', outDir, '--rootDir', 'src/lib/nucleos',
      '--module', 'commonjs', '--target', 'es2020',
      '--esModuleInterop', '--skipLibCheck',
    ],
    { cwd: REPO, stdio: 'pipe' },
  )
  const require = createRequire(import.meta.url)
  const compiled = outDir
  const { extractCbamFields } = require(path.join(compiled, 'extraction-client.js'))
  const { toExtractedFieldRows } = require(path.join(compiled, 'field-mapper.js'))
  const { getSupplierFormContext } = require(path.join(compiled, 'supplier-form-client.js'))
  const { checkCbamScope } = require(path.join(compiled, 'scope-client.js'))
  const verification = require(path.join(compiled, 'verification-client.js'))
  const { buildCaseEvidence } = require(path.join(compiled, 'case-evidence.js'))
  const { explainGoodsLineField } = require(path.join(compiled, 'explain-client.js'))
  const relief = require(path.join(compiled, 'relief-client.js'))
  const { getSupplierHistory } = require(path.join(compiled, 'supplier-history-client.js'))
  const narrativeClient = require(path.join(compiled, 'narrative-client.js'))

  console.log('── Extraction boundary ──')
  const result = await extractCbamFields({
    document_id: 'boundary-doc-1',
    document_type: 'CUSTOMS_DECLARATION',
    entity_id: 'boundary-entity',
    text: INVOICE,
    pages: [{ page_number: 1, text: INVOICE }],
    reporting_period_end: '2027-03-31',
    reporting_year: 2027,
    jurisdiction: 'EU',
    ocr_quality: { truncated: false, truncation_reason: null, mean_confidence: 0.97, engine: 'transcribe' },
  })

  check('client and service agree on the response shape', result && typeof result === 'object')
  check('document_id round-trips', result.document_id === 'boundary-doc-1', result.document_id)
  check('engine version is stamped', Boolean(result.engine?.engine_version), JSON.stringify(result.engine))
  check('fields came back', Array.isArray(result.fields) && result.fields.length > 0, `${result.fields?.length} fields`)

  const eori = result.fields.find(f => f.field_name === 'importer_eori')
  check('a known field is extracted', eori?.raw_value === 'GB123456789000', eori?.raw_value)
  check('source text travels with it', Boolean(eori?.source_text), 'no source_text')

  const line = (result.lines ?? [])[0]
  check('a goods line came back', Boolean(line), 'no lines')
  check('CN code is read', line?.cn_code === '72071111', line?.cn_code)
  // The N6 fix, proven over the wire rather than in a unit test.
  check('thousand-separated mass survives the boundary', line?.net_mass_kg === 24500, String(line?.net_mass_kg))

  check('no provenance tier is asserted', !JSON.stringify(result).includes('provenance_tier'))

  console.log('\n── Field mapping ──')
  const rows = toExtractedFieldRows(result)
  check('maps to ExtractedField rows', rows.length > 0, `${rows.length} rows`)
  check('rows carry no provenance tier', !rows.some(r => 'provenanceTier' in r))

  console.log('\n── Fails closed ──')
  let rejected = false
  try {
    await extractCbamFields({
      document_id: 'boundary-doc-2', document_type: 'CUSTOMS_DECLARATION',
      entity_id: 'boundary-entity', text: INVOICE, jurisdiction: 'EU',
      blob_url: 'https://example.invalid/doc.pdf',
    })
  } catch {
    rejected = true
  }
  check('a blob reference is refused by the service', rejected)

  console.log('\n── Scope check ──')
  const scope = await checkCbamScope({ cn_code: '72071111', origin_country: 'TR' })
  check('scope check answers', Boolean(scope?.status), JSON.stringify(scope)?.slice(0, 120))
  // Without an EORI and a consignment value the determination is deliberately
  // "requires_review" rather than a confident yes — the CN code is covered but
  // a factor is missing. What matters here is that it is not out_of_scope.
  check('a covered CN code is not written off as out of scope',
    scope?.status === 'in_scope' || scope?.status === 'requires_review', scope?.status)
  check('the answer cites its provisions', (scope?.regulation_refs ?? []).length > 0)

  console.log('\n── Supplier form ──')
  // A client pointed at a path that does not exist gets a 404, which used to be
  // reported to the supplier as an expired link. Every path a client calls has
  // to be exercised against the real router, or a wiring error hides as a
  // plausible-looking user-facing message.
  let supplierErr = null
  try {
    await getSupplierFormContext('definitely-not-a-real-token')
  } catch (e) {
    supplierErr = e
  }
  // The harness runs on SQLite, which has no cbam schema, so the handler itself
  // errors — and that is the point: an error FROM the handler proves the route
  // exists. A wrong path produces "endpoint not found" instead, which is exactly
  // the failure that shipped once and reported itself as an expired link.
  check('supplier form reaches a real route',
    !/endpoint not found/i.test(supplierErr?.message ?? ''),
    supplierErr?.message?.slice(0, 100))

  console.log('\n── Verification ──')
  // Each step must reach a real route and have its body accepted. On SQLite the
  // handler itself fails, which is fine: that proves the route exists. A bare
  // "Not Found" means the path is wrong; a 422 means the body's field names do
  // not match what Nucleos expects — the statement would never be recorded.
  const aLine = '00000000-0000-0000-0000-00000000b0b0'
  const steps = {
    'request-verification': () => verification.requestVerification(aLine),
    'upload-verification (a reference, not a file)': () =>
      verification.recordVerificationStatement(aLine, {
        verifierName: 'Carbon Assurance Ltd',
        verifierAccreditation: 'UKAS 9876',
        documentRef: 'arbor:verification:boundary',
        sha256: 'a'.repeat(64),
      }),
    verify: () => verification.acceptVerification(aLine),
    'reject-verification': () => verification.rejectVerification(aLine, 'Boundary check.'),
  }
  for (const [name, call] of Object.entries(steps)) {
    let stepErr = null
    try {
      await call()
    } catch (e) {
      stepErr = e
    }
    const message = stepErr?.message ?? ''
    check(`${name} reaches a real route and its body is accepted`,
      message !== 'Not Found' && !/ 422 /.test(message),
      message.slice(0, 100))
  }

  console.log('\n── Carbon price relief ──')
  // Same test as verification: each call reaches a real route and its body is
  // accepted. On SQLite the handlers fail (no cbam schema), which proves the
  // route exists; " 404 " from the router means a wrong path, " 422 " a body
  // Nucleos does not accept — the statement would never reach the claim.
  const reliefCalls = {
    'qualifying schemes': () => relief.listQualifyingSchemes('DE'),
    'claims for a goods line': () => relief.listReliefClaims(aLine),
  }
  for (const [name, call] of Object.entries(reliefCalls)) {
    let callErr = null
    try {
      await call()
    } catch (e) {
      callErr = e
    }
    const message = callErr?.message ?? ''
    check(`${name} reaches a real route and is accepted`,
      !/ 404 /.test(message) && !/ 422 /.test(message) && message !== 'Not Found',
      message.slice(0, 100))
  }

  // HMRC's monthly rate comes from Nucleos's reference table, not the database,
  // so this one answers in full even on SQLite.
  let hmrcRate = null
  try {
    hmrcRate = await relief.getHmrcExchangeRate('EUR', '2026-04-15')
  } catch (e) {
    hmrcRate = { error: e.message }
  }
  check("HMRC's exchange rate for the month comes back", hmrcRate?.rate === '0.864304', JSON.stringify(hmrcRate))

  // The relief client reads a 404 as "no claim waiting", so a wrong path would
  // pass through it unnoticed. Watch what Nucleos actually answers instead.
  let reliefStatus = null
  let reliefBody = ''
  try {
    await relief.recordReliefStatement(
      aLine,
      { documentRef: 'arbor:verification:boundary', sha256: 'a'.repeat(64) },
      async (url, init) => {
        const res = await fetch(url, init)
        reliefStatus = res.status
        reliefBody = await res.clone().text()
        return res
      },
    )
  } catch {
    // On SQLite the handler may fail; what matters is which route answered.
  }
  check('relief statement (a reference, not a file) reaches a real route and is accepted',
    reliefStatus !== null && reliefStatus !== 422 && reliefBody.trim() !== '{"detail":"Not Found"}',
    `${reliefStatus} ${reliefBody.slice(0, 100)}`)

  console.log('\n── Supplier history ──')
  // The client reads a 404 as "no history", so a wrong path would pass through
  // it unnoticed. The route's own 404 names the goods line; the router's does not.
  let historyStatus = null
  let historyBody = ''
  try {
    await getSupplierHistory(aLine, async (url, init) => {
      const res = await fetch(url, init)
      historyStatus = res.status
      historyBody = await res.clone().text()
      return res
    })
  } catch {
    // On SQLite the handler may fail; what matters is which route answered.
  }
  check('supplier history reaches a real route',
    historyStatus !== null && historyStatus !== 422 && historyBody.trim() !== '{"detail":"Not Found"}',
    `${historyStatus} ${historyBody.slice(0, 100)}`)

  console.log('\n── Why this number? ──')
  // The evidence Arbor files when it opens a case, built by the real builder,
  // must be accepted as Nucleos's EvidenceAtom: a 422 here means "Why this
  // number?" would have nothing to show for every case. The body wrapper
  // mirrors case-writer.ts's sendEvidence.
  const aCase = '00000000-0000-0000-0000-00000000cafe'
  const atoms = buildCaseEvidence({
    readFields: [{ fieldName: 'lines[0].net_mass_kg', extractedValue: '24 500', sourceText: 'Net mass | 24 500 kg', confidence: 0.9 }],
    confirmed: { 'lines[0].net_mass_kg': '24500' },
    lineIds: { '0': aLine },
  })
  const evRes = await fetch(`${BASE}/api/cbam/cases/${aCase}/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ source_ref: 'arbor:document:boundary', evidence: atoms }),
  })
  const evBody = await evRes.text()
  check('the evidence builder produces atoms', atoms.length === 1, JSON.stringify(atoms))
  check('evidence reaches a real route and its atoms are accepted',
    evRes.status !== 422 && !(evRes.status === 404 && /"Not Found"/.test(evBody)),
    `${evRes.status} ${evBody.slice(0, 100)}`)

  // The explain client maps a 404 to "nothing recorded", so a wrong path would
  // pass silently through it. Watch what Nucleos actually answers instead.
  let explainStatus = null
  let explainBody = ''
  const watching = async (url, init) => {
    const res = await fetch(url, init)
    explainStatus = res.status
    explainBody = await res.clone().text()
    return res
  }
  try {
    await explainGoodsLineField(aCase, aLine, 'net_mass_kg', { fetchImpl: watching })
  } catch {
    // On SQLite the handler may fail; what matters is which route answered.
  }
  // On SQLite the handler itself fails (500), which proves the route exists. A
  // bare "Not Found" is the router's answer for a path that does not.
  check('explain reaches a real route and its query is accepted',
    explainStatus !== null && explainStatus !== 400 && explainStatus !== 422 &&
      explainBody.trim() !== '{"detail":"Not Found"}',
    `${explainStatus} ${explainBody.slice(0, 100)}`)

  console.log('\n── Audit narrative ──')
  // The token above carries what production's does: cbam:read and cbam:write.
  // Without narrative:run, Nucleos refuses, and the client must say that
  // rather than report Nucleos as down.
  let narrativeErr = null
  try {
    await narrativeClient.runCompliancePack(aCase)
  } catch (e) {
    narrativeErr = e
  }
  check('without narrative:run, the refusal is reported as a missing scope',
    narrativeErr instanceof narrativeClient.NarrativeNotAllowedError,
    narrativeErr?.message?.slice(0, 100))

  // With the scope, the route has to exist. On SQLite the handler fails; a
  // bare "Not Found" would mean the client calls a path Nucleos does not serve.
  const narrativeToken = await mintToken(['cbam:read', 'cbam:write', 'narrative:run'])
  let packStatus = null
  let packBody = ''
  process.env.NUCLEOS_INTERNAL_TOKEN = narrativeToken
  try {
    await narrativeClient.runCompliancePack(aCase, async (url, init) => {
      const res = await fetch(url, init)
      packStatus = res.status
      packBody = await res.clone().text()
      return res
    })
  } catch {
    // Expected on SQLite.
  } finally {
    process.env.NUCLEOS_INTERNAL_TOKEN = token
  }
  check('with narrative:run, the compliance pack reaches a real route',
    packStatus !== null && packStatus !== 403 && packBody.trim() !== '{"detail":"Not Found"}',
    `${packStatus} ${packBody.slice(0, 100)}`)

  console.log('\n── Calculation boundary ──')
  const calcRes = await fetch(`${BASE}/api/internal/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      case_reference: 'boundary-case', entity_id: 'boundary-entity',
      jurisdiction: 'EU', reporting_year: 2027,
      lines: [{ line_id: 'gl-1', cn_code: '72071111', net_mass_kg: 24500, provenance_tier: 'DECLARED' }],
    }),
  })
  check('calculate responds 200', calcRes.ok, String(calcRes.status))
  const calc = calcRes.ok ? await calcRes.json() : {}
  const cl = calc.lines?.[0]
  check('emissions method is chosen', cl?.emissions_method === 'DEFAULT', cl?.emissions_method)
  check('provenance is echoed, not recomputed', cl?.provenance_tier === 'DECLARED', cl?.provenance_tier)
  check('the 2027 mark-up is applied', Math.abs((cl?.markup_fraction ?? 0) - 0.2) < 1e-9, String(cl?.markup_fraction))
  check('versions are stamped on the result', Boolean(calc.engine?.markup_table_version), JSON.stringify(calc.engine))

  const empty = await fetch(`${BASE}/api/internal/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ case_reference: 'c', entity_id: 'e', jurisdiction: 'EU', reporting_year: 2027, lines: [] }),
  })
  check('an empty declaration is rejected', empty.status === 422, String(empty.status))
} catch (err) {
  console.error(`\nBoundary check failed to run: ${err.message}`)
  if (serverLog.trim()) console.error(`\nNucleos output:\n${serverLog.slice(-2000)}`)
  exitCode = 2
} finally {
  server.kill('SIGTERM')
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('Failed:\n' + failed.map(f => `  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`).join('\n'))
  exitCode = 1
}
process.exit(exitCode)
