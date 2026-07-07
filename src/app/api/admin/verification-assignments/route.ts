import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const bodySchema = z.object({
  entityId: z.string().min(1),
  verifierEmail: z.string().email(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
})

// an admin assigns a verifier to verify an entity+period.
export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const { entityId, verifierEmail, periodStart, periodEnd } = parsed.data

  const verifier = await prisma.user.findUnique({ where: { email: verifierEmail.toLowerCase() } })
  if (!verifier || verifier.role !== 'VERIFIER') {
    return err('No verifier account found for that email', 'VERIFIER_NOT_FOUND', 404)
  }

  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!entity) return err('Entity not found', 'NOT_FOUND', 404)

  if (new Date(periodEnd) <= new Date(periodStart)) {
    return err('periodEnd must be after periodStart', 'INVALID_PERIOD', 400)
  }

  const assignment = await prisma.verificationAssignment.create({
    data: {
      entityId,
      verifierId: verifier.id,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
    },
  })

  return ok({ id: assignment.id, status: assignment.status }, 201)
}
