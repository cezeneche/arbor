// Flag escalation. Scheduled worker (Vercel Cron).
//
// An owner and a deadline are only a control if something happens when the
// deadline passes. This finds unresolved flags past their dueAt, stamps
// escalatedAt so each one can only ever notify once, and tells the entity that
// items on their data have gone past due.
//
// Deliberately NOT a data correction: no record, tier, or audit chain is touched.
// The flag's severity, message and assignee are unchanged — escalation is a
// notification event, so the certified store is untouched by a missed deadline.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fails closed if
// the secret is unset.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { flagsNeedingEscalation, type SlaFlag } from '@/lib/stewardship/sla'
import { sendNotification } from '@/lib/notifications'
import { DOMAIN_LABELS } from '@/lib/domain-labels'

export const dynamic = 'force-dynamic'

const FLAG_CAP = 5000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const now = new Date()

  // Narrow in SQL to what could possibly be overdue; the pure policy makes the
  // final call so the rule lives in exactly one place.
  const candidates = await prisma.validationFlag.findMany({
    where: {
      resolvedAt: null,
      escalatedAt: null,
      dueAt: { not: null, lte: now },
    },
    select: {
      id: true,
      severity: true,
      assigneeId: true,
      dueAt: true,
      resolvedAt: true,
      escalatedAt: true,
      assignee: { select: { name: true } },
      dataRecord: { select: { entityId: true, domain: true } },
    },
    take: FLAG_CAP,
  })

  if (candidates.length === 0) {
    return Response.json({ status: 'noop', reason: 'nothing overdue', escalated: 0 })
  }

  const slaFlags: SlaFlag[] = candidates.map(f => ({
    id: f.id,
    severity: f.severity,
    assigneeId: f.assigneeId,
    dueAt: f.dueAt,
    resolvedAt: f.resolvedAt,
    escalatedAt: f.escalatedAt,
  }))
  const overdueIds = new Set(flagsNeedingEscalation(slaFlags, now).map(f => f.id))
  const overdue = candidates.filter(f => overdueIds.has(f.id))

  if (overdue.length === 0) {
    return Response.json({ status: 'noop', reason: 'nothing overdue', escalated: 0 })
  }

  // Stamp first. If notification delivery fails afterwards the flag is still
  // marked escalated, so a retry cannot notify the same entity twice — the
  // escalation is visible in the portal either way.
  await prisma.validationFlag.updateMany({
    where: { id: { in: [...overdueIds] } },
    data: { escalatedAt: now },
  })

  // One notification per entity+domain rather than one per flag: a steward with
  // eleven overdue items needs one message, not eleven.
  const grouped = new Map<string, { entityId: string; domain: string; count: number; stewardName: string }>()
  for (const f of overdue) {
    const entityId = f.dataRecord.entityId
    const domain = f.dataRecord.domain
    const key = `${entityId} ${domain}`
    const held = grouped.get(key)
    if (held) {
      held.count += 1
    } else {
      grouped.set(key, {
        entityId,
        domain,
        count: 1,
        stewardName: f.assignee?.name ?? 'nobody in particular',
      })
    }
  }

  // Delivery is fail-soft — the escalation is already recorded.
  const notified = await Promise.allSettled(
    [...grouped.values()].map(g =>
      sendNotification({
        entityId: g.entityId,
        type: 'FLAG_OVERDUE',
        payload: {
          flagCount: g.count,
          stewardName: g.stewardName,
          domain: DOMAIN_LABELS[g.domain] ?? g.domain,
        },
      }),
    ),
  )
  notified.forEach(r => {
    if (r.status === 'rejected') {
      console.error('[escalate-flags] notification failed:', r.reason)
    }
  })

  return Response.json({
    status: 'ok',
    escalated: overdue.length,
    notifications: grouped.size,
  })
}
