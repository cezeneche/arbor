// Whether a deployment can serve the product. Pure: the route gathers the facts.
import type { TokenExpiry } from '@/lib/nucleos/service-auth'

/** Warn this many days before the Nucleos service token expires. */
export const TOKEN_WARNING_DAYS = 14

export interface ReadinessFacts {
  missingEnv: string[]
  database: { ok: boolean; detail?: string }
  nucleos: { ok: boolean; detail?: string }
  rateLimiter: { ok: boolean; detail?: string }
  serviceToken: TokenExpiry
}

export interface Readiness {
  ready: boolean
  checks: {
    environment: { ok: boolean; missing: string[] }
    database: { ok: boolean; detail?: string }
    nucleos: { ok: boolean; detail?: string }
    rateLimiter: { ok: boolean; detail?: string }
    serviceToken: { ok: boolean; expiresAt: string | null; daysLeft: number | null }
  }
  warnings: string[]
}

export function evaluateReadiness(facts: ReadinessFacts): Readiness {
  const warnings: string[] = []
  const token = facts.serviceToken
  if (!token.expired && token.daysLeft !== null && token.daysLeft < TOKEN_WARNING_DAYS) {
    warnings.push(
      `The Nucleos service token expires in ${token.daysLeft} day(s), on ${token.expiresAt}. ` +
        'Mint a new one and set NUCLEOS_INTERNAL_TOKEN before then.',
    )
  }

  const checks: Readiness['checks'] = {
    environment: { ok: facts.missingEnv.length === 0, missing: facts.missingEnv },
    database: facts.database,
    nucleos: facts.nucleos,
    rateLimiter: facts.rateLimiter,
    serviceToken: { ok: !token.expired, expiresAt: token.expiresAt, daysLeft: token.daysLeft },
  }
  return { ready: Object.values(checks).every(c => c.ok), checks, warnings }
}
