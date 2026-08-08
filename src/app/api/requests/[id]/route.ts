import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import { canTransitionRequest } from '@/lib/requests/status-machine'
import { Prisma } from '@prisma/client'

const patchSchema = z.object({
  status: z.enum(['SUBMITTED', 'ACCEPTED', 'QUERY_RAISED', 'CLOSED']),
  notes: z.string().optional(),
})

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

  // A status is a position in a lifecycle, not a permission. Checking only "may
  // this party ever set this value" let a buyer accept a request nobody had
  // answered, reopen a closed one, and let a supplier re-submit indefinitely.
  const verdict = canTransitionRequest(dataRequest.status, parsed.data.status, isSupplier ? 'SUPPLIER' : 'BUYER')
  if (!verdict.allowed) {
    return err(verdict.message, verdict.reason === 'not_this_party' ? 'FORBIDDEN' : 'INVALID_TRANSITION', verdict.reason === 'not_this_party' ? 403 : 409)
  }

  // Conditional on the status we read, so two updates racing on the same request
  // cannot both pass the check above and apply in an order neither party intended.
  const applied = await prisma.dataRequest.updateMany({
    where: { id, status: dataRequest.status },
    data: {
      status: parsed.data.status,
      notes: parsed.data.notes,
      ...(parsed.data.status === 'SUBMITTED' ? { respondedAt: new Date() } : {}),
    },
  })
  if (applied.count === 0) {
    return err('This request changed while you were working on it. Reload and try again.', 'CONFLICT', 409)
  }
  const updated = await prisma.dataRequest.findUniqueOrThrow({ where: { id } })

  if (parsed.data.status === 'SUBMITTED') {
    // Both period fields must be set together — a grant with only one set is a misconfiguration
    // that would silently expand or eliminate period filtering on the buyer's export queries.
    if ((dataRequest.periodStart === null) !== (dataRequest.periodEnd === null)) {
      return err('Request period is misconfigured: periodStart and periodEnd must both be set or both be null', 'INVALID_STATE', 500)
    }

    // Scoped to the fields the buyer asked for, not the whole domain — see the
    // submission-link route for the same reasoning.
    const requiredFields = Array.isArray(dataRequest.requiredFields)
      ? (dataRequest.requiredFields as unknown[]).filter((f): f is string => typeof f === 'string')
      : []

    const existing = await prisma.dataAccessGrant.findFirst({
      where: {
        grantorEntityId: dataRequest.supplierEntityId,
        granteeEntityId: dataRequest.buyerEntityId,
        domain: dataRequest.domain,
        isActive: true,
        fieldNames: { equals: Prisma.DbNull },
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
          ...(requiredFields.length > 0 ? { fieldNames: requiredFields } : {}),
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
