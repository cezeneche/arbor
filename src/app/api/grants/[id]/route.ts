import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

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
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
