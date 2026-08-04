// Layer 3 — read-only. The signed-in person's open flags: what they personally
// own and are on the clock for.
//
// Also returns the entity's unowned flags. A steward seeing only their own queue
// would never discover that a whole domain has no owner, which is precisely the
// condition worth surfacing.
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { escalationState, type SlaFlag } from '@/lib/stewardship/sla'
import { DOMAIN_LABELS } from '@/lib/domain-labels'

export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const user = getSessionUser(session)
  const userId = user.id as string
  const entityId = user.entityId as string

  const rows = await prisma.validationFlag.findMany({
    where: {
      resolvedAt: null,
      dataRecord: { entityId },
      OR: [{ assigneeId: userId }, { assigneeId: null }],
    },
    select: {
      id: true,
      severity: true,
      flagType: true,
      message: true,
      assigneeId: true,
      assignedVia: true,
      dueAt: true,
      resolvedAt: true,
      escalatedAt: true,
      dataRecord: {
        select: { id: true, domain: true, fieldName: true, periodStart: true, periodEnd: true },
      },
    },
    orderBy: [{ dueAt: 'asc' }],
  })

  const now = new Date()
  const flags = rows.map(f => {
    const sla: SlaFlag = {
      id: f.id,
      severity: f.severity,
      assigneeId: f.assigneeId,
      dueAt: f.dueAt,
      resolvedAt: f.resolvedAt,
      escalatedAt: f.escalatedAt,
    }
    return {
      id: f.id,
      recordId: f.dataRecord.id,
      domain: f.dataRecord.domain,
      domainLabel: DOMAIN_LABELS[f.dataRecord.domain] ?? f.dataRecord.domain,
      fieldName: f.dataRecord.fieldName,
      periodStart: f.dataRecord.periodStart,
      periodEnd: f.dataRecord.periodEnd,
      severity: f.severity,
      flagType: f.flagType,
      message: f.message,
      mine: f.assigneeId === userId,
      assignedVia: f.assignedVia,
      dueAt: f.dueAt,
      state: escalationState(sla, now),
    }
  })

  const mine = flags.filter(f => f.mine)
  return NextResponse.json({
    mine,
    unassigned: flags.filter(f => !f.mine),
    overdue: mine.filter(f => f.state === 'OVERDUE' || f.state === 'ESCALATED').length,
  })
}
