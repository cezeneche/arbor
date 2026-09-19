// Proving an account controls its email address.
//
// Not a gate: sign-in works either way, because a pilot account must not be
// locked out by a delivery problem. It is a recorded fact — emailVerifiedAt —
// so an unconfirmed address is never presented as a confirmed one. Tokens are
// single-use and stored only as their SHA-256 hash, like password reset.
import type { PrismaClient } from '@prisma/client'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/tokens/opaque-token'

export const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Db = Pick<PrismaClient, 'emailVerificationToken' | 'user' | '$transaction'>

export async function issueEmailVerification(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string }> {
  const token = generateOpaqueToken()
  await db.emailVerificationToken.create({
    data: { userId, tokenHash: hashOpaqueToken(token), expiresAt: new Date(now.getTime() + VERIFY_TTL_MS) },
  })
  return { token }
}

export async function consumeEmailVerification(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<'verified' | 'expired' | 'invalid'> {
  const tokenHash = hashOpaqueToken(token)
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash } })
  if (!record || record.usedAt) return 'invalid'
  if (record.expiresAt.getTime() <= now.getTime()) return 'expired'
  await db.$transaction(async tx => {
    await tx.emailVerificationToken.update({ where: { tokenHash }, data: { usedAt: now } })
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } })
  })
  return 'verified'
}
