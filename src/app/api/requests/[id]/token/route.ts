import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/tokens/opaque-token'

// Minting a 30-day public submission link is a write action — a read-only VIEWER
// must not be able to create one, so gate on write access (not just membership).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const { id } = await params
  const entityId = getSessionUser(session).entityId as string

  const request = await prisma.dataRequest.findUnique({ where: { id } })
  if (!request) return err('Request not found', 'NOT_FOUND', 404)
  if (request.buyerEntityId !== entityId) return err('Forbidden', 'FORBIDDEN', 403)

  // Raw token goes into the link (below); only its hash is stored.
  const token = generateOpaqueToken()
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await prisma.dataRequest.update({
    where: { id },
    data: { submissionTokenHash: hashOpaqueToken(token), submissionTokenExpiry: expiry },
  })

  // NEXT_PUBLIC_APP_URL is the canonical external origin (set in production —
  // asserted at build). BASE_URL kept as a legacy fallback only.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const link = `${baseUrl}/submit/${token}`

  return ok({ link, expiresAt: expiry.toISOString() }, 201)
}
