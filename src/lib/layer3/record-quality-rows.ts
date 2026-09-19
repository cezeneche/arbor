// Layer 3 — the grouped rows behind the Records screen's quality summary.
//
// The summary covers the whole filtered set, not the page on screen. It used
// to load every matching record to count them, which grew with the store.
// Postgres groups and counts instead; one row per group carries its count.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { QualityRecord } from './record-quality'

const DEFAULT_EXPIRY_WINDOW_DAYS = 30

export async function loadRecordQualityRows(
  filter: { entityId: string; domain?: string; trustTier?: string },
  now: Date = new Date(),
): Promise<QualityRecord[]> {
  const horizon = new Date(now.getTime() + DEFAULT_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRaw<
    { domain: string; fieldName: string; trustTier: 'A' | 'B' | 'C'; documentType: string | null; expiring: boolean; count: number }[]
  >(Prisma.sql`
    SELECT r."domain"::text AS "domain", r."fieldName", r."trustTier"::text AS "trustTier",
           d."documentType"::text AS "documentType",
           (r."staleAfterDate" IS NOT NULL AND r."staleAfterDate" <= ${horizon}) AS "expiring",
           count(*)::int AS "count"
    FROM "DataRecord" r
    LEFT JOIN "Document" d ON d."id" = r."documentId"
    WHERE r."entityId" = ${filter.entityId}
      AND r."isActive" = true
      ${filter.domain ? Prisma.sql`AND r."domain"::text = ${filter.domain}` : Prisma.empty}
      ${filter.trustTier ? Prisma.sql`AND r."trustTier"::text = ${filter.trustTier}` : Prisma.empty}
    GROUP BY 1, 2, 3, 4, 5
  `)
  // Expiring rows carry the horizon as their date, which the summariser counts
  // as expiring; the others carry none.
  return rows.map(r => ({
    domain: r.domain,
    fieldName: r.fieldName,
    trustTier: r.trustTier,
    documentType: r.documentType,
    staleAfterDate: r.expiring ? horizon : null,
    count: r.count,
  }))
}
