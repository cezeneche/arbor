#!/usr/bin/env node
// Run the Nucleos Python suite from the repo root.
//
// Arguments pass straight through, so the usual pytest selectors work:
//   npm run test:python -- -k cbam_calculate
//   npm run test:python -- api/tests/ledger/test_tenant_isolation.py -v
//
// Postgres-dependent tests (tenant isolation / RLS, the full pipeline) skip
// unless TEST_DATABASE_URL is set. That is a real hole in the deployment gate,
// not a quirk — CLAUDE.md's gate says zero skips — so the runner says so rather
// than printing a green summary over the top of them. To close it:
//
//   cd nucleos && ./scripts/create_test_db.sh
//   TEST_DATABASE_URL="postgresql+psycopg2://postgres@127.0.0.1:5432/nucleos_test" \
//     npm run test:python
//
// See the header of that script for why the migration order is what it is.

import { spawnSync } from 'node:child_process'
import { NUCLEOS_DIR, pythonPath, requireVenvBin } from './python-env.mjs'

const bin = requireVenvBin()
const passthrough = process.argv.slice(2)

const hasPostgres = Boolean(process.env.TEST_DATABASE_URL)
if (!hasPostgres) {
  console.log(
    'TEST_DATABASE_URL is not set. Tests needing Postgres — tenant isolation (RLS)\n' +
      'and the full pipeline — will skip. See the header of this script to run them.\n',
  )
}

const result = spawnSync(pythonPath(bin), ['-m', 'pytest', ...passthrough], {
  cwd: NUCLEOS_DIR,
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  console.error(`Could not run pytest: ${result.error.message}`)
  process.exit(2)
}
process.exit(result.status ?? 1)
