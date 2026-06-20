import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// Gap 6.4 — delete a webhook subscription owned by the caller's entity.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { id } = await params

  const sub = await prisma.webhookSubscription.findUnique({ where: { id }, select: { entityId: true } })
  if (!sub) return err('Subscription not found', 'NOT_FOUND', 404)
  if (sub.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  await prisma.webhookSubscription.delete({ where: { id } })
  return ok({ ok: true })
}
