import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

const schema = z.object({ granteeEntityId: z.string().min(1) })

// Gap 5.1/5.5 — revoke every active grant from the caller's entity to one buyer
// in a single action, and notify that buyer once.
export async function POST(req: NextRequest) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const { granteeEntityId } = parsed.data

  const result = await prisma.dataAccessGrant.updateMany({
    where: { grantorEntityId: entityId, granteeEntityId, isActive: true },
    data: { isActive: false, revokedAt: new Date() },
  })

  if (result.count > 0) {
    await sendNotification({
      entityId: granteeEntityId,
      type: 'ACCESS_REVOKED',
      payload: { grantId: 'all', grantorEntityId: entityId },
    }).catch((e) => console.error('[grants/revoke-all] notify failed:', e))
    await dispatchWebhook(granteeEntityId, 'access.revoked', { grantId: 'all', grantorEntityId: entityId })
  }

  return NextResponse.json({ ok: true, revoked: result.count })
}
