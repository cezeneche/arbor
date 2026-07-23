// Relearning extractor — exemplar fetch. This is the DB-reading half, kept in the
// Layer-1 ORCHESTRATOR (the inngest extract function already reads/writes the
// extraction-staging tables), NOT in the pure extraction engine — so the AI path
// itself stays DB-free per the layering rule. Within-tenant only, fail-soft.

import { prisma as defaultPrisma } from '@/lib/prisma'
import { buildExemplarHints, type ExemplarHint, type CorrectionLabel } from './correction-exemplars'

/** How many recent corrections to consider — bounded, most-recent-first. */
const EXEMPLAR_LABEL_CAP = 200

/** Opt-in kill switch. Off by default: this changes Layer-1 prompt behaviour, so
 *  it ships dark and is enabled deliberately (and can be A/B'd against the
 *  accuracy monitor). */
export function exemplarsEnabled(): boolean {
  return process.env.EXTRACTION_EXEMPLARS === '1'
}

interface ExemplarPrismaLike {
  groundTruthLabel: {
    findMany: (args: {
      where: Record<string, unknown>
      select: Record<string, boolean>
      orderBy: Record<string, string>
      take: number
    }) => Promise<{ fieldName: string; extractedValue: string | null; confirmedValue: string | null }[]>
  }
}

/**
 * Fetch a tenant's own past review corrections for a document class and reduce
 * them to attention hints. Tenant isolation is enforced by the `entityId` filter
 * — one company's corrections never inform another's extraction. Fail-soft: any
 * error yields no hints, so relearning can never block or degrade ingestion.
 */
export async function fetchCorrectionExemplars(
  entityId: string,
  documentClass: string,
  deps: { prisma?: ExemplarPrismaLike } = {},
): Promise<ExemplarHint[]> {
  const db = deps.prisma ?? (defaultPrisma as unknown as ExemplarPrismaLike)
  try {
    const labels = await db.groundTruthLabel.findMany({
      where: { entityId, documentClass, source: 'REVIEW_CORRECTED' },
      select: { fieldName: true, extractedValue: true, confirmedValue: true },
      orderBy: { createdAt: 'desc' },
      take: EXEMPLAR_LABEL_CAP,
    })
    return buildExemplarHints(labels as CorrectionLabel[])
  } catch {
    return []
  }
}
