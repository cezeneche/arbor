import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

const createSchema = z.object({
  granteeEntityId: z.string().min(1),
  domain: z.string().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      OR: [{ grantorEntityId: entityId }, { granteeEntityId: entityId }],
      isActive: true,
    },
    include: {
      grantorEntity: { select: { legalName: true } },
      granteeEntity: { select: { legalName: true } },
    },
    orderBy: { grantedAt: 'desc' },
  })

  return NextResponse.json({ grants })
}

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const { granteeEntityId, domain, periodStart, periodEnd } = parsed.data

  const grantee = await prisma.entity.findUnique({ where: { id: granteeEntityId }, select: { legalName: true } })
  if (!grantee) return NextResponse.json({ error: 'Grantee entity not found.' }, { status: 404 })

  const grant = await prisma.dataAccessGrant.create({
    data: {
      grantorEntityId: entityId,
      granteeEntityId,
      domain: domain as never ?? null,
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
    },
  })

  await sendNotification({
    entityId: granteeEntityId,
    type: 'ACCESS_GRANTED',
    payload: { grantId: grant.id, grantorEntityId: entityId },
  }).catch(e => console.error('[grants] sendNotification failed:', e))

  return NextResponse.json({ grant })
}
