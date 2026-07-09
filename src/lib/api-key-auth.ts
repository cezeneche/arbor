import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { validateAuthHeader } from '@/lib/api-key-auth-pure'
import { getClientIp } from '@/lib/rate-limit-pure'
import { isApiKeyExpired, isIpAllowed, type ApiKeyScopeValue } from '@/lib/api-key-scope'

export interface ApiKeyAuthResult {
  authorized: boolean
  entityId: string | null
  scope: ApiKeyScopeValue | null
  reason: string | null
}

const deny = (reason: string): ApiKeyAuthResult => ({ authorized: false, entityId: null, scope: null, reason })

export async function authenticateApiKey(
  authHeader: string | null,
  clientIp?: string | null,
): Promise<ApiKeyAuthResult> {
  const headerResult = validateAuthHeader(authHeader)
  if (!headerResult.authorized || !headerResult.rawKey) {
    return deny(headerResult.reason ?? 'Unauthorized')
  }

  const rawKey = headerResult.rawKey

  // Key format: arb_<8-hex-prefix>_<48-hex-secret>
  // The prefix is stored in the DB, enabling a single-row lookup instead of
  // loading and bcrypt-comparing every active key.
  const parts = rawKey.split('_')
  if (parts.length !== 3 || parts[0] !== 'arb' || parts[1].length !== 8) {
    return deny('Invalid API key format')
  }
  const keyPrefix = parts[1]

  const key = await prisma.apiKey.findUnique({
    where: { keyPrefix },
    select: {
      id: true, entityId: true, keyHash: true, isActive: true, revokedAt: true,
      scope: true, expiresAt: true, ipAllowlist: true,
    },
  })

  if (!key || !key.isActive || key.revokedAt) {
    return deny('Invalid API key')
  }

  const match = await bcrypt.compare(rawKey, key.keyHash)
  if (!match) {
    return deny('Invalid API key')
  }

  if (isApiKeyExpired(key.expiresAt)) {
    return deny('API key has expired')
  }
  if (!isIpAllowed(key.ipAllowlist, clientIp)) {
    return deny('API key is not permitted from this IP address')
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsed: new Date() },
  })

  return { authorized: true, entityId: key.entityId, scope: key.scope, reason: null }
}

/** Convenience wrapper: authenticate from a request, extracting the bearer header
 *  and the client IP (for allowlist enforcement) in one call. */
export function authenticateApiKeyRequest(req: NextRequest): Promise<ApiKeyAuthResult> {
  return authenticateApiKey(
    req.headers.get('authorization'),
    getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')),
  )
}
