import { X509Certificate } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import { databaseConnection, migrationDatabaseUrl, SUPABASE_ROOT_CA_2021 } from '@/lib/db-tls'

// pg merges parameters parsed from the URL over the options passed beside it.
// Testing through pg's own parser is the only way to know the URL cannot undo
// the TLS policy.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConnectionParameters = require('pg/lib/connection-parameters')

const REMOTE = 'postgresql://user:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'

describe('databaseConnection', () => {
  // Expected: no TLS for a database on this machine (local dev, CI's Postgres
  // service). Reason: they have no certificate, and the traffic never leaves the host.
  it.each([
    'postgresql://postgres:postgres@localhost:5432/arbor',
    'postgresql://postgres:postgres@127.0.0.1:5432/arbor',
    'postgresql://postgres:postgres@[::1]:5432/arbor',
  ])('leaves a local database alone: %s', url => {
    expect(databaseConnection(url)).toEqual({ connectionString: url })
  })

  // Expected: undefined passes through. Reason: DATABASE_URL is absent during
  // some builds, and Prisma reports that itself on first query.
  it('passes an unset connection string through', () => {
    expect(databaseConnection(undefined)).toEqual({ connectionString: undefined })
  })

  // Expected: verified TLS trusting the public roots plus Supabase's own root.
  // Reason: the Supabase pooler accepts plaintext and its certificate chains to a
  // private root Node does not ship, so without this the connection is either
  // unencrypted or unverified.
  it('requires verified TLS for a remote database', () => {
    const { ssl } = databaseConnection(REMOTE)
    expect(ssl).toBeDefined()
    expect(ssl!.rejectUnauthorized).toBe(true)
    expect(ssl!.ca).toContain(SUPABASE_ROOT_CA_2021)
    expect(ssl!.ca).toEqual(expect.arrayContaining([...rootCertificates]))
  })

  // Expected: TLS parameters removed from the URL, every other parameter kept.
  // Reason: pg lets URL parameters override the ssl option, so sslmode=disable
  // would switch TLS off and sslmode=require would drop the Supabase root.
  it('strips TLS parameters from the URL and keeps the rest', () => {
    const url = `${REMOTE}?sslmode=disable&sslrootcert=/tmp/x.crt&uselibpqcompat=true&application_name=arbor`
    const { connectionString } = databaseConnection(url)
    const params = new URL(connectionString!).searchParams
    expect(params.get('sslmode')).toBeNull()
    expect(params.get('sslrootcert')).toBeNull()
    expect(params.get('uselibpqcompat')).toBeNull()
    expect(params.get('application_name')).toBe('arbor')
    expect(new URL(connectionString!).password).toBe('secret')
  })

  // Expected: after pg parses everything, TLS is still on and verifying, even
  // when the URL asked for it to be off. Reason: this is the behaviour that matters.
  it.each(['disable', 'require', 'no-verify', 'prefer'])(
    'survives pg parsing a URL with sslmode=%s',
    mode => {
      const conn = databaseConnection(`${REMOTE}?sslmode=${mode}`)
      const parsed = new ConnectionParameters(conn)
      expect(parsed.ssl).toMatchObject({ rejectUnauthorized: true })
      expect(parsed.ssl.ca).toContain(SUPABASE_ROOT_CA_2021)
    },
  )
})

describe('SUPABASE_ROOT_CA_2021', () => {
  const cert = new X509Certificate(SUPABASE_ROOT_CA_2021)

  // Expected: the pinned fingerprint. Reason: checked on 17 October 2026 against
  // both the root the live pooler presents and Supabase's published download
  // (prod-ca-2021.crt); an edit to the PEM must be deliberate.
  it('is the root Supabase publishes', () => {
    expect(cert.subject).toContain('CN=Supabase Root 2021 CA')
    expect(cert.fingerprint256).toBe(
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
    )
  })

  // Expected: at least 90 days of validity left. Reason: when it expires every
  // database connection fails; this fails CI a quarter ahead instead.
  it('has at least 90 days left before it expires', () => {
    const ninetyDays = 90 * 24 * 60 * 60 * 1000
    expect(new Date(cert.validTo).getTime() - Date.now()).toBeGreaterThan(ninetyDays)
  })
})

describe('migrationDatabaseUrl', () => {
  // Expected: unchanged. Reason: CI's Postgres service and local dev have no
  // certificate, and the traffic never leaves the host.
  it.each([
    'postgresql://postgres:postgres@localhost:5432/arbor',
    'postgresql://postgres:postgres@127.0.0.1:5432/arbor',
  ])('leaves a local database alone: %s', url => {
    expect(migrationDatabaseUrl(url)).toBe(url)
  })

  it('passes an unset URL through', () => {
    expect(migrationDatabaseUrl(undefined)).toBeUndefined()
  })

  // Expected: sslmode=require. Reason: with no sslmode, Prisma's schema engine
  // tries TLS and falls back to plaintext, and the Supabase pooler accepts
  // plaintext, so a migration could run unencrypted.
  it('requires TLS for a remote database', () => {
    const url = new URL(migrationDatabaseUrl(REMOTE)!)
    expect(url.searchParams.get('sslmode')).toBe('require')
    expect(url.hostname).toBe('aws-0-eu-west-2.pooler.supabase.com')
    expect(url.password).toBe('secret')
  })

  // Expected: the URL cannot weaken it. Reason: same rule as the app's
  // connection, whatever the URL says.
  it.each(['sslmode=disable', 'sslmode=prefer', 'sslmode=allow&sslaccept=accept_invalid_certs'])(
    'overrides a weaker setting in the URL: %s',
    query => {
      const url = new URL(migrationDatabaseUrl(`${REMOTE}?${query}`)!)
      expect(url.searchParams.getAll('sslmode')).toEqual(['require'])
      expect(url.searchParams.has('sslaccept')).toBe(false)
    },
  )

  // Expected: other parameters kept. Reason: the pooler needs pgbouncer and
  // connection settings to stay as configured.
  it('keeps parameters that are not about TLS', () => {
    const url = new URL(migrationDatabaseUrl(`${REMOTE}?pgbouncer=true&connection_limit=1`)!)
    expect(url.searchParams.get('pgbouncer')).toBe('true')
    expect(url.searchParams.get('connection_limit')).toBe('1')
  })
})
