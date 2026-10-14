import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const schema = z.object({ userId: z.string().min(1).max(128) })

// Ownership metadata only: assigning work grants no data access and never
// resolves a flag, changes a measurement or restarts its original deadline.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const actor = getSessionUser(session)
  if (!actor.entityId) return NextResponse.json({ error: 'Organisation required.' }, { status: 403 })
  const body = schema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Choose an active team member.' }, { status: 400 })
  const member = await prisma.user.findFirst({
    where: {
      id: body.data.userId,
      entityId: actor.entityId,
      isActive: true,
      role: { in: ['ADMIN', 'CONTRIBUTOR'] },
    },
    select: { id: true, name: true },
  })
  if (!member)
    return NextResponse.json(
      { error: 'That person is not an active contributor in your organisation.' },
      { status: 400 },
    )
  const { id } = await params
  const result = await prisma.validationFlag.updateMany({
    where: { id, resolvedAt: null, dataRecord: { entityId: actor.entityId, isActive: true } },
    data: { assigneeId: member.id, assignedAt: new Date(), assignedVia: `ADMIN:${actor.id}` },
  })
  if (result.count === 0)
    return NextResponse.json({ error: 'This issue is no longer available to assign.' }, { status: 404 })
  return NextResponse.json({ assigneeId: member.id, assigneeName: member.name })
}
