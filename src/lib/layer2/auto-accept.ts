// Layer 2 auto-accept writer for low-stakes documents.
// Writes numeric extracted fields as Tier B (Declared) DataRecords immediately,
// so a record exists without forcing per-document review. No AI here; this is a
// pure Layer-2 write through the shared audit-chained record writer. The weekly
// digest later invites the user to review and upgrade these to Verified.
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from './record-writer'
import { computeStaleAfterDate } from './staleness'
import { normaliseToSI, isSupportedUnit } from '@/lib/layer3/unit-conversion'
import { DOMAIN_BY_DOCUMENT_TYPE, DataDomain } from '@/lib/constants'
import { NUMERIC_FIELDS, derivePeriod } from '@/lib/review/review-policy'
import { parseNumericValue } from '@/lib/parse-numeric'
import { ExtractionMethod, TrustTier } from '@prisma/client'

/**
 * Auto-accept a low-stakes document: write its numeric fields as Tier B records
 * and mark it ACCEPTED. Returns the created record ids. If no numeric field has a
 * value, writes nothing and leaves the document in its current (review) status so
 * the user can complete it manually.
 */
export async function autoAcceptDocument(documentId: string): Promise<string[]> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      extractionJobs: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        include: { extractedFields: true },
      },
    },
  })
  if (!document) return []
  const job = document.extractionJobs[0]
  if (!job) return []

  const domain = (DOMAIN_BY_DOCUMENT_TYPE[document.documentType] ?? DataDomain.COMPLIANCE) as DataDomain

  const values: Record<string, string | null> = {}
  for (const f of job.extractedFields) values[f.fieldName] = f.rawValue
  const { periodStart, periodEnd } = derivePeriod(values, { documentType: document.documentType })

  const prepared = job.extractedFields
    .filter((f) => NUMERIC_FIELDS.has(f.fieldName) && f.rawValue !== null && f.rawValue !== '')
    .map((f) => {
      const rawNum = parseNumericValue(f.rawValue) ?? NaN
      return { f, rawNum }
    })
    .filter((p) => !isNaN(p.rawNum))
    .map(({ f, rawNum }) => {
      const unit = f.rawUnit ?? 'unknown'
      const lower = unit.toLowerCase()
      const { value: siValue, siUnit } = isSupportedUnit(lower)
        ? normaliseToSI(rawNum, lower)
        : { value: rawNum, siUnit: unit }
      return { f, rawNum, unit, siValue, siUnit }
    })

  if (prepared.length === 0) return []

  const staleAfterDate = computeStaleAfterDate(document.documentType, periodEnd)

  return prisma.$transaction(
    async (tx) => {
      const ids: string[] = []
      for (const { f, rawNum, unit, siValue, siUnit } of prepared) {
        const prior = await tx.dataRecord.findMany({
          where: { entityId: document.entityId, domain, fieldName: f.fieldName, periodStart, periodEnd, isActive: true },
          select: { id: true },
        })

        const result = await writeRecordWithAuditEntry(
          tx,
          {
            entityId: document.entityId,
            domain,
            fieldName: f.fieldName,
            value: siValue,
            unit: siUnit,
            originalValue: rawNum,
            originalUnit: unit,
            periodStart,
            periodEnd,
            trustTier: TrustTier.B,
            extractionMethod: ExtractionMethod.DOCUMENT_AI,
            submittedById: document.submittedById,
            documentId,
            sourceText: f.sourceText,
            confidenceScore: f.confidenceScore,
            staleAfterDate,
          },
          'CREATED',
        )

        if (prior.length > 0) {
          await tx.dataRecord.updateMany({
            where: { id: { in: prior.map((p) => p.id) } },
            data: { isActive: false, supersededById: result.recordId },
          })
        }
        ids.push(result.recordId)
      }

      await tx.document.update({ where: { id: documentId }, data: { status: 'ACCEPTED' } })
      return ids
    },
    { isolationLevel: 'Serializable' },
  )
}
