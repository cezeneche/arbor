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

  const activeKeys = await prisma.apiKey.findMany({
    where: { isActive: true, revokedAt: null },
    select: { id: true, entityId: true, keyHash: true },
  })

  for (const key of activeKeys) {
    const match = await bcrypt.compare(rawKey, key.keyHash)
    if (match) {
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsed: new Date() },
      })
      return { authorized: true, entityId: key.entityId, reason: null }
    }
  }

  return { authorized: false, entityId: null, reason: 'Invalid API key' }
}
