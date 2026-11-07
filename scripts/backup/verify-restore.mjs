#!/usr/bin/env node
// The nightly restore drill. Run by .github/workflows/backup.yml after the dump
// has been restored into a scratch Postgres, and before it is encrypted. Exits
// non-zero, failing the backup, if the restore is not a whole, identical copy.
//
//   RESTORED_URL=postgresql://…scratch  SOURCE_URL=postgresql://…production \
//   SCHEMAS=public KIND=arbor  node --no-warnings scripts/backup/verify-restore.mjs
//
// Production is only read. Both connections use the app's verified TLS
// (src/lib/db-tls.ts), which Node runs directly. Writes a JSON summary to
// stdout's last line for the backup manifest.

import pg from 'pg'
import { databaseConnection } from '../../src/lib/db-tls.ts'
import { chainProblems, countProblems, recordHashProblems, tailProblems } from './restore-checks.mjs'

const { RESTORED_URL, SOURCE_URL, SCHEMAS = 'public', KIND = 'arbor' } = process.env
if (!RESTORED_URL || !SOURCE_URL) {
  console.error('RESTORED_URL and SOURCE_URL are required.')
  process.exit(2)
}
const schemas = SCHEMAS.split(',')
  .map(s => s.trim())
  .filter(Boolean)

async function connect(url) {
  const client = new pg.Client(databaseConnection(url))
  await client.connect()
  return client
}

const quote = name => `"${name.replace(/"/g, '""')}"`

async function tableCounts(client, tables) {
  const counts = []
  for (const t of tables) {
    const { rows } = await client.query(
      `SELECT count(*)::bigint AS n FROM ${quote(t.schema)}.${quote(t.name)}`,
    )
    counts.push({ table: `${t.schema}.${t.name}`, rows: Number(rows[0].n) })
  }
  return counts
}

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT table_schema AS schema, table_name AS name FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema = ANY($1) ORDER BY 1, 2`,
    [schemas],
  )
  return rows
}

const restored = await connect(RESTORED_URL)
const source = await connect(SOURCE_URL)
const problems = []
const summary = { kind: KIND, schemas }

try {
  // The restore holds the snapshot pg_dump took; production has moved on since,
  // so it may have more rows but never fewer tables, and never fewer rows.
  const sourceTables = await listTables(source)
  const restoredTables = await listTables(restored)
  const sourceCounts = await tableCounts(source, sourceTables)
  const restoredCounts = await tableCounts(restored, restoredTables)
  problems.push(...countProblems(restoredCounts, sourceCounts))
  summary.tables = restoredCounts.length
  summary.rows = restoredCounts.reduce((n, c) => n + c.rows, 0)

  if (KIND === 'arbor') {
    const { rows: entries } = await restored.query(
      `SELECT "entityId", sequence, hash, "previousHash", "recordId" FROM "AuditEntry"`,
    )
    problems.push(...chainProblems(entries))

    const { rows: records } = await restored.query(`SELECT id, "auditHash" FROM "DataRecord"`)
    problems.push(...recordHashProblems(records, entries))

    const { rows: tails } = await restored.query(
      `SELECT DISTINCT ON ("entityId") "entityId", sequence, hash FROM "AuditEntry"
       ORDER BY "entityId", sequence DESC`,
    )
    const { rows: sourceAtTails } = tails.length
      ? await source.query(
          `SELECT a."entityId", a.sequence, a.hash FROM "AuditEntry" a
           JOIN unnest($1::text[], $2::int[]) AS t(entity_id, seq)
             ON a."entityId" = t.entity_id AND a.sequence = t.seq`,
          [tails.map(t => t.entityId), tails.map(t => t.sequence)],
        )
      : { rows: [] }
    problems.push(...tailProblems(tails, sourceAtTails))

    summary.entities = tails.length
    summary.auditEntries = entries.length
    summary.records = records.length
  }
} finally {
  await Promise.allSettled([restored.end(), source.end()])
}

summary.problems = problems.length
if (problems.length > 0) {
  console.error(`The restore drill found ${problems.length} problem(s):`)
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`)
  if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`)
}
console.log(JSON.stringify(summary))
process.exit(problems.length > 0 ? 1 : 0)
