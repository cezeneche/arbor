// Every table in public has row-level security on.
//
// Arbor reaches its tables only through Prisma, as their owner, which RLS
// does not restrict (it is enabled, not forced). With RLS on and no policies,
// any other role, such as Supabase's Data API roles, sees no rows at all.
// Production had RLS switched on by hand on 7 November 2026; migration
// 20261109000000_enable_row_level_security records it, and this check keeps
// the next new table from being created without it. Run after
// `prisma migrate deploy` against an empty database.
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const { rows } = await client.query(`
  SELECT c.relname AS table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  ORDER BY 1
`)
await client.end()

if (rows.length > 0) {
  console.error(
    `${rows.length} table(s) in public without row-level security:\n` +
      rows.map(r => `  - ${r.table}`).join('\n') +
      '\nAdd `ALTER TABLE "<name>" ENABLE ROW LEVEL SECURITY;` to the migration that creates each one.',
  )
  process.exit(1)
}
console.log('Every table in public has row-level security on.')
