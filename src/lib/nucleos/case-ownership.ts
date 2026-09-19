// Which organisation a CBAM case belongs to.
//
// Every Arbor organisation reaches Nucleos with the same service token, so
// Nucleos's own tenant check sees one tenant and cannot tell Arbor's
// organisations apart. The link row written when a confirmation opens a case is
// the only record of ownership, so it is the gate for every case read and write.
//
// A case with no link has no provable owner. It is refused rather than shown:
// "readable because nobody recorded who owns it" is how one organisation ends
// up reading another's declarations.

import { prisma } from '@/lib/prisma'

interface OwnershipDb {
  cbamCaseLink: {
    findFirst(args: {
      where: { nucleosCaseId: string; entityId: string }
      select: { documentId: true }
    }): Promise<{ documentId: string } | null>
    findMany(args: {
      where: { entityId: string; nucleosCaseId: { not: null } }
      select: { nucleosCaseId: true }
      orderBy: { createdAt: 'desc' }
    }): Promise<{ nucleosCaseId: string | null }[]>
  }
}

export type CaseAccess = { allowed: true; documentId: string } | { allowed: false }

export async function resolveCaseAccess(
  caseId: string,
  entityId: string,
  db: OwnershipDb = prisma as unknown as OwnershipDb,
): Promise<CaseAccess> {
  if (!caseId || !entityId) return { allowed: false }
  const link = await db.cbamCaseLink.findFirst({
    where: { nucleosCaseId: caseId, entityId },
    select: { documentId: true },
  })
  return link ? { allowed: true, documentId: link.documentId } : { allowed: false }
}

/** The organisation's cases, newest first. */
export async function ownedCaseIds(
  entityId: string,
  db: OwnershipDb = prisma as unknown as OwnershipDb,
): Promise<string[]> {
  const rows = await db.cbamCaseLink.findMany({
    where: { entityId, nucleosCaseId: { not: null } },
    select: { nucleosCaseId: true },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(r => r.nucleosCaseId).filter((id): id is string => Boolean(id))
}

/**
 * Whether a goods line is on a case.
 *
 * Goods-line ids arrive from the browser. Checking the case is the caller's is
 * not enough on its own — the line has to be checked against that case too, or
 * an owned case id becomes a pass for any line in Nucleos.
 */
export function goodsLineBelongsToCase(
  caseRecord: Record<string, unknown>,
  goodsLineId: string,
): boolean {
  if (!goodsLineId) return false
  const lines = caseRecord.goods_lines
  if (!Array.isArray(lines)) return false
  return lines.some(l => (l as { id?: unknown })?.id === goodsLineId)
}
