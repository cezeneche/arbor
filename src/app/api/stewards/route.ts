// Who looks after which kind of data at this company.
//
// GET lists the current stewards plus the entity's open-flag workload per owner,
// including the Unassigned bucket — the whole point being that "nobody's job" is
// visible rather than absent.
//
// PUT sets (or clears) the steward for one domain. ADMIN only: naming who is
// accountable is an ownership decision, not a data entry one.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { requireAuth, requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { summariseStewardWorkload, type WorkloadFlag } from '@/lib/layer3/steward-workload'
import { domainSchema } from '@/lib/constants'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import type { DataDomain } from '@/lib/constants'

export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const [stewards, members, flags] = await Promise.all([
    prisma.domainSteward.findMany({
      where: { entityId },
      select: {
        domain: true,
        userId: true,
        assignedAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.user.findMany({
      where: { entityId, isActive: true, role: { notIn: ['SYSTEM'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
    prisma.validationFlag.findMany({
      where: { resolvedAt: null, dataRecord: { entityId } },
      select: {
        id: true,
        severity: true,
        assigneeId: true,
        dueAt: true,
        resolvedAt: true,
        escalatedAt: true,
        assignee: { select: { name: true } },
        dataRecord: { select: { domain: true } },
      },
    }),
  ])

  const workloadFlags: WorkloadFlag[] = flags.map(f => ({
    id: f.id,
    severity: f.severity,
    assigneeId: f.assigneeId,
    assigneeName: f.assignee?.name ?? null,
    domain: f.dataRecord.domain as DataDomain,
    dueAt: f.dueAt,
    resolvedAt: f.resolvedAt,
    escalatedAt: f.escalatedAt,
  }))

  const stewardByDomain = new Map(stewards.map(s => [s.domain, s]))

  // Every domain is listed, including those with no steward — a gap in
  // accountability is the finding, so it must not be an empty row you scroll past.
  const coverage = Object.keys(DOMAIN_LABELS).map(domain => {
    const s = stewardByDomain.get(domain as never)
    return {
      domain,
      domainLabel: DOMAIN_LABELS[domain],
      stewardUserId: s?.userId ?? null,
      stewardName: s?.user.name ?? null,
      assignedAt: s?.assignedAt ?? null,
      openFlags: workloadFlags.filter(f => f.domain === domain).length,
    }
  })

  return NextResponse.json({
    coverage,
    members,
    workload: summariseStewardWorkload(workloadFlags, new Date()),
    unstewardedDomainsWithData: coverage.filter(c => !c.stewardUserId && c.openFlags > 0).length,
  })
}

const setSchema = z.object({
  domain: domainSchema,
  // null clears the steward for that domain.
  userId: z.string().min(1).nullable(),
})

export async function PUT(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const actor = getSessionUser(session)
  const entityId = actor.entityId as string

  const body = await req.json().catch(() => null)
  const parsed = setSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { domain, userId } = parsed.data

  if (userId === null) {
    await prisma.domainSteward.deleteMany({ where: { entityId, domain } })
    return NextResponse.json({ domain, stewardUserId: null })
  }

  // The steward must belong to this entity — accountability cannot be delegated
  // outside the company that owns the data.
  const member = await prisma.user.findFirst({
    where: { id: userId, entityId, isActive: true },
    select: { id: true, name: true },
  })
  if (!member) {
    return NextResponse.json(
      { error: 'That person is not an active member of your company.' },
      { status: 400 },
    )
  }

  await prisma.domainSteward.upsert({
    where: { entityId_domain: { entityId, domain } },
    create: { entityId, domain, userId, assignedById: actor.id as string },
    update: { userId, assignedById: actor.id as string, assignedAt: new Date() },
  })

  return NextResponse.json({ domain, stewardUserId: userId, stewardName: member.name })
}
