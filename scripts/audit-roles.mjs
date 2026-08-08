#!/usr/bin/env node
// Read-only. Lists who holds which role, per entity, so the effect of the
// ADMIN-only tightening is visible before anyone is surprised by a 403.
//
// Benchmark-aggregation consent, grant revocation and bilateral definition
// governance moved from "any write-capable role" to ADMIN, because each binds
// the whole organisation rather than editing one figure. An entity whose only
// members are CONTRIBUTORs can no longer perform them — that is the intended
// outcome, but it should be a decision, not a discovery.
//
//   node scripts/audit-roles.mjs
//
// Reads DATABASE_URL from the environment (or .env). Writes nothing.

import { readFileSync } from 'node:fs'
import pg from 'pg'

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const line = env.split('\n').find(l => l.startsWith('DATABASE_URL='))
    return line?.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

const connectionString = databaseUrl()
if (!connectionString) {
  console.error('DATABASE_URL is not set and could not be read from .env')
  process.exit(2)
}

const client = new pg.Client({ connectionString })
await client.connect()

try {
  const { rows } = await client.query(`
    SELECT e."legalName"                       AS entity,
           u."role"                            AS role,
           u."email"                           AS email,
           u."isActive"                        AS active,
           u."isPlatformAdmin"                 AS platform_admin
    FROM "User" u
    JOIN "Entity" e ON e."id" = u."entityId"
    WHERE u."role" <> 'SYSTEM'
    ORDER BY e."legalName", u."role", u."email"
  `)

  if (rows.length === 0) {
    console.log('No entity-scoped users found.')
    process.exit(0)
  }

  const byEntity = new Map()
  for (const r of rows) {
    if (!byEntity.has(r.entity)) byEntity.set(r.entity, [])
    byEntity.get(r.entity).push(r)
  }

  const strandedEntities = []

  for (const [entity, users] of byEntity) {
    const admins = users.filter(u => u.role === 'ADMIN' && u.active)
    console.log(`\n${entity}`)
    for (const u of users) {
      const flags = [
        u.active ? null : 'INACTIVE',
        u.platform_admin ? 'platform-operator' : null,
      ].filter(Boolean)
      console.log(`  ${u.role.padEnd(12)} ${u.email}${flags.length ? `  [${flags.join(', ')}]` : ''}`)
    }
    if (admins.length === 0) {
      strandedEntities.push(entity)
      console.log('  ⚠  no active ADMIN — cannot manage consent, revoke grants, or agree definitions')
    }
  }

  console.log('\n' + '─'.repeat(60))
  if (strandedEntities.length === 0) {
    console.log('Every entity has at least one active ADMIN. Nothing to do.')
  } else {
    console.log(`${strandedEntities.length} entity/entities have no active ADMIN:`)
    for (const e of strandedEntities) console.log(`  - ${e}`)
    console.log('\nPromote one member of each to ADMIN, e.g.:')
    console.log(`  UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = '<their email>';`)
    console.log('\nNote: an ADMIN must enrol 2FA before they can use the portal or the API.')
  }
} finally {
  await client.end()
}
