import { evaluateReadiness, TOKEN_WARNING_DAYS } from '../readiness'

// Readiness answers "can this deployment serve the product", not "is the
// process up". A reachable app with no database, a Nucleos that cannot reach
// its own, or a service token that expired yesterday is not ready.
const good = {
  missingEnv: [],
  database: { ok: true },
  nucleos: { ok: true },
  serviceToken: { expiresAt: null, daysLeft: null, expired: false },
}

describe('evaluateReadiness', () => {
  it('is ready when everything checks out', () => {
    const r = evaluateReadiness(good)
    expect(r.ready).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('is not ready without a required setting, the database, or Nucleos', () => {
    expect(evaluateReadiness({ ...good, missingEnv: ['NUCLEOS_URL'] }).ready).toBe(false)
    expect(evaluateReadiness({ ...good, database: { ok: false, detail: 'timeout' } }).ready).toBe(false)
    expect(evaluateReadiness({ ...good, nucleos: { ok: false, detail: '503' } }).ready).toBe(false)
  })

  it('is not ready once the Nucleos service token has expired', () => {
    const r = evaluateReadiness({ ...good, serviceToken: { expiresAt: '2026-01-01T00:00:00.000Z', daysLeft: -3, expired: true } })
    expect(r.ready).toBe(false)
  })

  it('stays ready but warns when the token expires soon', () => {
    const r = evaluateReadiness({
      ...good,
      serviceToken: { expiresAt: '2026-10-01T00:00:00.000Z', daysLeft: TOKEN_WARNING_DAYS - 1, expired: false },
    })
    expect(r.ready).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/expires in/)
  })

  it('names missing settings but never their values', () => {
    const r = evaluateReadiness({ ...good, missingEnv: ['RESEND_API_KEY'] })
    expect(r.checks.environment).toEqual({ ok: false, missing: ['RESEND_API_KEY'] })
  })
})
