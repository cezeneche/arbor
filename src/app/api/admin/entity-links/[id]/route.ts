import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { decideEntityLink } from '@/lib/entity-resolution/decide'

// a human resolves a candidate link (ADMIN). The rules — terminal decision,
// PENDING only, entities never merged — live in decideEntityLink, which the
// Matches page uses too.
const bodySchema = z.object({ action: z.enum(['confirm', 'reject']) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!
  const userId = getSessionUser(session).id
  const { id } = await params

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const reviewedAt = new Date()
  const result = await decideEntityLink(prisma, { id, action: parsed.data.action, userId, now: reviewedAt })
  if (!result.ok) {
    return result.reason === 'NOT_FOUND'
      ? err('Candidate link not found', 'NOT_FOUND', 404)
      : err('This candidate has already been reviewed', 'ALREADY_REVIEWED', 409)
  }

  return ok({ id, status: result.status, reviewedAt: reviewedAt.toISOString() })
}
