import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

const patchSchema = z.object({
  status: z.enum(['SUBMITTED', 'ACCEPTED', 'QUERY_RAISED', 'CLOSED']),
  notes: z.string().optional(),
})

const SUPPLIER_ALLOWED_STATUSES = new Set(['SUBMITTED', 'QUERY_RAISED'])
const BUYER_ALLOWED_STATUSES = new Set(['ACCEPTED', 'CLOSED', 'QUERY_RAISED'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const dataRequest = await prisma.dataRequest.findUnique({ where: { id } })
  if (!dataRequest) return err('Request not found', 'NOT_FOUND', 404)

  const isBuyer = dataRequest.buyerEntityId === entityId
  const isSupplier = dataRequest.supplierEntityId === entityId
  if (!isBuyer && !isSupplier) return err('Access denied', 'FORBIDDEN', 403)

  const allowedStatuses = isSupplier ? SUPPLIER_ALLOWED_STATUSES : BUYER_ALLOWED_STATUSES
  if (!allowedStatuses.has(parsed.data.status)) {
    return err(`Your role on this request cannot set status '${parsed.data.status}'`, 'FORBIDDEN', 403)
  }

  const updated = await prisma.dataRequest.update({
    where: { id },
    data: {
      status: parsed.data.status,
      notes: parsed.data.notes,
      ...(parsed.data.status === 'SUBMITTED' ? { respondedAt: new Date() } : {}),
    },
  })

  if (parsed.data.status === 'SUBMITTED') {
    // Both period fields must be set together — a grant with only one set is a misconfiguration
    // that would silently expand or eliminate period filtering on the buyer's export queries.
    if ((dataRequest.periodStart === null) !== (dataRequest.periodEnd === null)) {
      return err('Request period is misconfigured: periodStart and periodEnd must both be set or both be null', 'INVALID_STATE', 500)
    }

    const existing = await prisma.dataAccessGrant.findFirst({
      where: {
        grantorEntityId: dataRequest.supplierEntityId,
        granteeEntityId: dataRequest.buyerEntityId,
        domain: dataRequest.domain,
        isActive: true,
        AND: [
          { OR: [{ periodStart: null }, { periodStart: { lte: dataRequest.periodStart } }] },
          { OR: [{ periodEnd: null }, { periodEnd: { gte: dataRequest.periodEnd } }] },
        ],
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
    }).catch(e => console.error('[requests] sendNotification failed:', e))
  }

  return ok(updated)
}
