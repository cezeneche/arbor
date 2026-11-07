import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Arbor reads and writes every table through Prisma, connected as the owner.
// Supabase's Data API (/rest/v1/) runs as anon or authenticated, and Supabase
// used to grant both roles everything on new tables in public. Found on 31
// October 2026: production still had those grants with RLS off, so anyone with
// the project's anon key could reach every record around the audit chain. They
// were revoked by hand; this migration makes every other environment match.

const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations')
const API_ROLES = /\b(anon|authenticated)\b/

function migration(dir: string): string {
  return readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8')
}

const dirs = readdirSync(MIGRATIONS).filter(d => d !== 'migration_lock.toml')
const revokeDir = dirs.find(d => d.endsWith('_revoke_data_api_grants'))

it('a migration revokes the Data API roles', () => {
  expect(revokeDir).toBeDefined()
})

describe('the revoke migration', () => {
  const sql = revokeDir ? migration(revokeDir).replace(/--.*$/gm, '') : ''

  it('removes every grant the roles hold on public tables and sequences', () => {
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated/)
  })

  it('stops tables created later from picking the grants up again', () => {
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated/,
    )
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated/,
    )
  })

  it('runs on a plain Postgres that has no Supabase roles', () => {
    expect(sql).toMatch(/pg_roles WHERE rolname = 'anon'/)
    expect(sql).toMatch(/pg_roles WHERE rolname = 'authenticated'/)
  })

  it('leaves service_role alone, since document storage uses it', () => {
    expect(sql).not.toMatch(/service_role/)
  })
})

it('no migration grants anything to the Data API roles', () => {
  const offenders = dirs.filter(d =>
    migration(d)
      .replace(/--.*$/gm, '')
      .split(';')
      .some(stmt => /\bGRANT\b/i.test(stmt) && !/\bREVOKE\b/i.test(stmt) && API_ROLES.test(stmt)),
  )
  expect(offenders).toEqual([])
})
