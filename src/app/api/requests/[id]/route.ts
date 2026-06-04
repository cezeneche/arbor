import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

const patchSchema = z.object({
  status: z.enum(['SUBMITTED', 'ACCEPTED', 'QUERY_RAISED', 'CLOSED']),
  notes: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const dataRequest = await prisma.dataRequest.findUnique({ where: { id } })
  if (!dataRequest) return err('Request not found', 'NOT_FOUND', 404)

  const isParty =
    dataRequest.buyerEntityId === entityId || dataRequest.supplierEntityId === entityId
  if (!isParty) return err('Access denied', 'FORBIDDEN', 403)

  const updated = await prisma.dataRequest.update({
    where: { id },
    data: {
      status: parsed.data.status,
      notes: parsed.data.notes,
      ...(parsed.data.status === 'SUBMITTED' ? { respondedAt: new Date() } : {}),
    },
  })

  if (parsed.data.status === 'SUBMITTED') {
    // Create a DataAccessGrant so the buyer can see the supplier's data
    const existing = await prisma.dataAccessGrant.findFirst({
      where: {
        grantorEntityId: dataRequest.supplierEntityId,
        granteeEntityId: dataRequest.buyerEntityId,
        domain: dataRequest.domain,
        isActive: true,
      },
    })
    if (!existing) {
      await prisma.dataAccessGrant.create({
        data: {
          grantorEntityId: dataRequest.supplierEntityId,
          granteeEntityId: dataRequest.buyerEntityId,
          domain: dataRequest.domain,
          periodStart: dataRequest.periodStart,
          periodEnd: dataRequest.periodEnd,
        },
      })
    }
    await sendNotification({
      entityId: dataRequest.buyerEntityId,
      type: 'DATA_REQUEST_RESPONDED',
      payload: { requestId: id, supplierEntityId: dataRequest.supplierEntityId },
    }).catch(() => {})
  }

  return ok(updated)
}
