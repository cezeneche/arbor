import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { validateAuthHeader } from '@/lib/api-key-auth-pure'

export interface ApiKeyAuthResult {
  authorized: boolean
  entityId: string | null
  reason: string | null
}

export async function authenticateApiKey(authHeader: string | null): Promise<ApiKeyAuthResult> {
  const headerResult = validateAuthHeader(authHeader)
  if (!headerResult.authorized || !headerResult.rawKey) {
    return { authorized: false, entityId: null, reason: headerResult.reason }
  }

  const rawKey = headerResult.rawKey

  // Key format: arb_<8-hex-prefix>_<48-hex-secret>
  // The prefix is stored in the DB, enabling a single-row lookup instead of
  // loading and bcrypt-comparing every active key.
  const parts = rawKey.split('_')
  if (parts.length !== 3 || parts[0] !== 'arb' || parts[1].length !== 8) {
    return { authorized: false, entityId: null, reason: 'Invalid API key format' }
  }
  const keyPrefix = parts[1]

  const key = await prisma.apiKey.findUnique({
    where: { keyPrefix },
    select: { id: true, entityId: true, keyHash: true, isActive: true, revokedAt: true },
  })

  if (!key || !key.isActive || key.revokedAt) {
    return { authorized: false, entityId: null, reason: 'Invalid API key' }
  }

  const match = await bcrypt.compare(rawKey, key.keyHash)
  if (!match) {
    return { authorized: false, entityId: null, reason: 'Invalid API key' }
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsed: new Date() },
  })

  return { authorized: true, entityId: key.entityId, reason: null }
}
