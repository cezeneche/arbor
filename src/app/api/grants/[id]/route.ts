import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Revocation is ADMIN-only, matching the bar for creating a grant. Cutting a
// buyer's access to a supplier's data mid-reporting-period is a commercial
// decision about the relationship, not a routine edit.
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string

  const { id } = await params
  const grant = await prisma.dataAccessGrant.findUnique({ where: { id } })

  if (!grant) return NextResponse.json({ error: 'Grant not found.' }, { status: 404 })
  if (grant.grantorEntityId !== entityId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  if (!grant.isActive) return NextResponse.json({ error: 'Grant already revoked.' }, { status: 409 })

  await prisma.dataAccessGrant.update({
    where: { id },
    data: { isActive: false, revokedAt: new Date() },
  })

  await sendNotification({
    entityId: grant.granteeEntityId,
    type: 'ACCESS_REVOKED',
    payload: { grantId: id, grantorEntityId: entityId },
  }).catch(e => console.error('[grants] sendNotification failed:', e))

  await dispatchWebhook(grant.granteeEntityId, 'access.revoked', { grantId: id, grantorEntityId: entityId })

  return NextResponse.json({ ok: true })
}
