// Which records a share shows. Layer 3, read-only.
//
// A share is a frozen submission: the records it was issued with, which its
// integrity hash covers. A figure corrected afterwards is superseded, not
// edited, so the issued record is still there to show, marked as corrected.
// Shares issued before snapshots existed carry no record list and keep the
// live scope they were created with.
import type { DataDomain, Prisma } from '@prisma/client'

export interface ShareScope {
  entityId: string
  recordIds: string[]
  domain: DataDomain | null
  periodStart: Date | null
  periodEnd: Date | null
}

export function isFrozenShare(share: Pick<ShareScope, 'recordIds'>): boolean {
  return share.recordIds.length > 0
}

export function shareRecordWhere(share: ShareScope): Prisma.DataRecordWhereInput {
  if (isFrozenShare(share)) return { entityId: share.entityId, id: { in: share.recordIds } }
  return {
    entityId: share.entityId,
    isActive: true,
    ...(share.domain ? { domain: share.domain } : {}),
    ...(share.periodStart ? { periodStart: { gte: share.periodStart } } : {}),
    ...(share.periodEnd ? { periodEnd: { lte: share.periodEnd } } : {}),
  }
}
