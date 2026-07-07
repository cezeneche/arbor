import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// Upgrade 5 — a human resolves a candidate link (ADMIN). Confirm or reject only;
// a decision is terminal, so a link can only be acted on while PENDING. This
// records the decision on the edge — it never merges or rewrites the entities,
// preserving record immutability and the audit chain. A CONFIRMED link is the
// authoritative "same entity" signal downstream consumers (and Upgrade 4's
// graph) rely on.
const bodySchema = z.object({ action: z.enum(['confirm', 'reject']) })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const userId = getSessionUser(session).id
  const { id } = await params

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const link = await prisma.entityLink.findUnique({ where: { id }, select: { status: true } })
  if (!link) return err('Candidate link not found', 'NOT_FOUND', 404)
  if (link.status !== 'PENDING') {
    return err('This candidate has already been reviewed', 'ALREADY_REVIEWED', 409)
  }

  const status = parsed.data.action === 'confirm' ? 'CONFIRMED' : 'REJECTED'
  const updated = await prisma.entityLink.update({
    where: { id },
    data: { status, reviewedById: userId, reviewedAt: new Date() },
    select: { id: true, status: true, reviewedAt: true },
  })

  return ok({
    id: updated.id,
    status: updated.status,
    reviewedAt: updated.reviewedAt?.toISOString() ?? null,
  })
}
