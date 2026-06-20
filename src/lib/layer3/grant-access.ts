// Layer 3 — Access & Sharing helpers. Read-only queries over grants.
import { prisma } from '@/lib/prisma'
import type { AccessMethod } from '@prisma/client'

// Gap 5.2 — record that a grantee viewed specific records. Best-effort; logging
// failures never block the read. Skips when there are no records.
export async function logRecordAccess(
  recordIds: string[],
  granteeEntityId: string,
  accessMethod: AccessMethod,
): Promise<void> {
  if (recordIds.length === 0) return
  try {
    await prisma.recordAccessLog.createMany({
      data: recordIds.map((recordId) => ({ recordId, granteeEntityId, accessMethod })),
    })
  } catch (e) {
    console.error('[grant-access] logRecordAccess failed:', e)
  }
}

// Gap 5 — entities with an active grant from `grantorEntityId` that covers the
// given domain and overlaps the given period. A grant with null domain/period is
// treated as covering everything (matches the supply-chain filtering semantics).
export async function findActiveGranteeEntityIds(
  grantorEntityId: string,
  domain: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<string[]> {
  const grants = await prisma.dataAccessGrant.findMany({
    where: { grantorEntityId, isActive: true, revokedAt: null },
    select: { granteeEntityId: true, domain: true, periodStart: true, periodEnd: true },
  })

  const matched = new Set<string>()
  for (const g of grants) {
    const domainMatch = !g.domain || g.domain === domain
    const startMatch = !g.periodStart || periodEnd >= g.periodStart
    const endMatch = !g.periodEnd || periodStart <= g.periodEnd
    if (domainMatch && startMatch && endMatch) matched.add(g.granteeEntityId)
  }
  return [...matched]
}
