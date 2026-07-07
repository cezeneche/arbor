import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const bodySchema = z.object({
  entityId: z.string().min(1),
  auditorEmail: z.string().email(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  expiresAt: z.string().datetime(),
})

// an admin grants a scoped, time-limited read-only audit access.
export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const { entityId, auditorEmail, periodStart, periodEnd, expiresAt } = parsed.data

  const auditor = await prisma.user.findUnique({ where: { email: auditorEmail.toLowerCase() } })
  if (!auditor || auditor.role !== 'AUDITOR') {
    return err('No auditor account found for that email', 'AUDITOR_NOT_FOUND', 404)
  }

  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!entity) return err('Entity not found', 'NOT_FOUND', 404)

  if (new Date(periodEnd) <= new Date(periodStart)) {
    return err('periodEnd must be after periodStart', 'INVALID_PERIOD', 400)
  }
  if (new Date(expiresAt) <= new Date()) {
    return err('expiresAt must be in the future', 'INVALID_EXPIRY', 400)
  }

  const access = await prisma.auditorAccess.create({
    data: {
      auditorUserId: auditor.id,
      entityId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      expiresAt: new Date(expiresAt),
    },
  })

  return ok({ id: access.id }, 201)
}
