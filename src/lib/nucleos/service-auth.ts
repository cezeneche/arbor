// The credential and correlation id every Arbor → Nucleos call carries.
//
// One place builds them so every client sends the same thing: the credential,
// and an x-request-id Nucleos logs against the request — so one failure can be
// followed across both services' logs.
//
// The credential is Arbor's Vercel OIDC token, exchanged for Nucleos's
// audience, when NUCLEOS_OIDC_AUDIENCE is set. Vercel issues it to every
// function and refreshes it (it lives about two hours), and the exchange makes
// it useless to anyone but Nucleos, so there is nothing to renew and no Nucleos
// secret in Arbor. Nucleos pins it to this project and the production
// environment (nucleos/api/shared_auth/vercel_service.py) and decides the
// scopes itself.
//
// NUCLEOS_INTERNAL_TOKEN, the year-long HS256 token minted by hand, is the
// fallback: used when no audience is set, or when the exchange fails.
import { randomUUID } from 'node:crypto'
import { getVercelOidcToken } from '@vercel/oidc'
import { NucleosUnavailableError } from './extraction-client'

export type NucleosAuthMode = 'oidc' | 'token' | 'none'

type Env = Record<string, string | undefined>

export function nucleosAuthMode(env: Env = process.env): NucleosAuthMode {
  if (env.NUCLEOS_OIDC_AUDIENCE) return 'oidc'
  if (env.NUCLEOS_INTERNAL_TOKEN) return 'token'
  return 'none'
}

async function nucleosCredential(env: Env): Promise<string> {
  const staticToken = env.NUCLEOS_INTERNAL_TOKEN
  const audience = env.NUCLEOS_OIDC_AUDIENCE
  if (audience) {
    try {
      return await getVercelOidcToken({ audience })
    } catch (err) {
      console.warn(`[nucleos] OIDC token unavailable, ${staticToken ? 'using the static token' : 'no fallback'}: ${(err as Error).message}`)
      if (!staticToken) throw new NucleosUnavailableError(`No Nucleos credential: ${(err as Error).message}`)
    }
  }
  if (!staticToken) throw new NucleosUnavailableError('NUCLEOS_OIDC_AUDIENCE or NUCLEOS_INTERNAL_TOKEN is not configured')
  return staticToken
}

export async function nucleosHeaders(
  extra: Record<string, string> = {},
  requestId: string = randomUUID(),
): Promise<Record<string, string>> {
  return {
    authorization: `Bearer ${await nucleosCredential(process.env)}`,
    'x-request-id': requestId,
    ...extra,
  }
}

/**
 * The static token whose expiry needs watching: only while it is the
 * credential in use. Behind OIDC it is a fallback, and alarms about renewing
 * it would ask someone to do work nothing depends on.
 */
export function monitoredServiceToken(env: Env = process.env): string {
  return nucleosAuthMode(env) === 'token' ? (env.NUCLEOS_INTERNAL_TOKEN ?? '') : ''
}

export interface TokenExpiry {
  expiresAt: string | null
  /** Whole days until expiry; negative once expired. Null when it never expires. */
  daysLeft: number | null
  expired: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When the service token expires. Read from the JWT's own claims without
 * verifying it — Arbor does not hold the signing key, and this is monitoring,
 * not authentication. Nothing in Arbor refreshes the token, so an expiry is a
 * date by which someone has to mint and set a new one.
 */
export function serviceTokenExpiry(token: string, now: Date = new Date()): TokenExpiry {
  const none: TokenExpiry = { expiresAt: null, daysLeft: null, expired: false }
  const payload = token.split('.')[1]
  if (!payload) return none
  let exp: unknown
  try {
    exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp
  } catch {
    return none
  }
  if (typeof exp !== 'number') return none
  const expiresAt = new Date(exp * 1000)
  return {
    expiresAt: expiresAt.toISOString(),
    daysLeft: Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS),
    expired: expiresAt.getTime() <= now.getTime(),
  }
}
