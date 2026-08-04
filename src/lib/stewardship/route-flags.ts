// Stamping ownership onto planned flags before they are written.
//
// The pure planner takes everything it needs as arguments; the impure companion
// below loads those things once per batch and calls it. Ownership is decided at
// raise time rather than by someone triaging later, because a queue nobody owns
// is exactly the failure being fixed.

import { prisma } from '@/lib/prisma'
import { resolveFlagOwner, type StewardAssignment, type EntityAdmin } from './assign'
import { dueDateFor, type FlagSeverity } from './sla'
import type { DataDomain } from '@/lib/constants'

/**
 * The minimum a planned flag must carry to be routed. Deliberately has no index
 * signature: callers pass their own concrete flag type as T and get it back with
 * the ownership fields added, so flagType and message survive to the write.
 */
export interface RoutableFlag {
  dataRecordId: string
  severity: FlagSeverity
}

export interface OwnershipStamp {
  assigneeId: string | null
  assignedAt: Date | null
  assignedVia: string | null
  dueAt: Date | null
}

export type OwnedFlag<T extends RoutableFlag> = T & OwnershipStamp

export interface OwnershipContext {
  entityId: string
  domainByRecordId: Map<string, DataDomain>
  stewards: StewardAssignment[]
  admins: EntityAdmin[]
  now: Date
}

const UNOWNED: OwnershipStamp = {
  assigneeId: null,
  assignedAt: null,
  assignedVia: null,
  dueAt: null,
}

/**
 * Attach an owner and a proportionate deadline to each planned flag. Pure.
 *
 * A flag with no owner also gets no deadline: a clock running against nobody is
 * theatre, and it would report as OVERDUE forever without anyone ever having been
 * asked to act. Unowned flags surface in the workload summary's Unassigned bucket
 * instead, which is the honest signal.
 */
export function planFlagOwnership<T extends RoutableFlag>(
  flags: T[],
  { entityId, domainByRecordId, stewards, admins, now }: OwnershipContext,
): OwnedFlag<T>[] {
  return flags.map(flag => {
    const domain = domainByRecordId.get(flag.dataRecordId)
    if (!domain) return { ...flag, ...UNOWNED }

    const owner = resolveFlagOwner({ entityId, domain, stewards, admins })
    if (!owner.userId) return { ...flag, ...UNOWNED }

    return {
      ...flag,
      assigneeId: owner.userId,
      assignedAt: now,
      assignedVia: owner.via,
      dueAt: dueDateFor(flag.severity, now),
    }
  })
}

/**
 * Layer 1/2 companion: load the entity's stewards, admins and the domains of the
 * records being flagged, then stamp ownership. One query set per batch, not per
 * flag. Never throws on a missing steward — that is a routing outcome, not an error.
 */
export async function stampFlagOwnership<T extends RoutableFlag>(
  flags: T[],
  entityId: string,
  now: Date = new Date(),
): Promise<OwnedFlag<T>[]> {
  if (flags.length === 0) return []

  const recordIds = [...new Set(flags.map(f => f.dataRecordId))]

  const [records, stewardRows, adminRows] = await Promise.all([
    prisma.dataRecord.findMany({
      where: { id: { in: recordIds } },
      select: { id: true, domain: true },
    }),
    prisma.domainSteward.findMany({
      where: { entityId },
      select: { entityId: true, domain: true, userId: true },
    }),
    prisma.user.findMany({
      where: { entityId, role: 'ADMIN', isActive: true },
      select: { id: true, createdAt: true },
    }),
  ])

  const domainByRecordId = new Map<string, DataDomain>(
    records.map(r => [r.id, r.domain as DataDomain]),
  )
  const stewards: StewardAssignment[] = stewardRows.map(s => ({
    entityId: s.entityId,
    domain: s.domain as DataDomain,
    userId: s.userId,
  }))
  const admins: EntityAdmin[] = adminRows.map(a => ({
    entityId,
    userId: a.id,
    createdAt: a.createdAt,
  }))

  return planFlagOwnership(flags, { entityId, domainByRecordId, stewards, admins, now })
}
