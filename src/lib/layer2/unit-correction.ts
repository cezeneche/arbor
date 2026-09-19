// Layer 2 — correcting records stored before every path used canonical units.
//
// A correction in Arbor is a new record that supersedes the old one, chained
// with its own audit entry. The original stays in the store, inactive, so the
// history of what was recorded and when is intact. Nothing here edits a value.
import type { DataDomain, ExtractionMethod, Prisma, TrustTier } from '@prisma/client'
import { canonicaliseMeasurement, UnsupportedUnitError } from './canonical-measurement'
import { writeRecordWithAuditEntry } from './record-writer'

export interface StoredRecord {
  id: string
  entityId: string
  domain: DataDomain
  fieldName: string
  value: number
  unit: string
  originalValue: number
  originalUnit: string
  periodStart: Date
  periodEnd: Date
  trustTier: TrustTier
  extractionMethod: ExtractionMethod
  submittedById: string
  confidenceScore: number
  sourceText: string | null
  documentId: string | null
  staleAfterDate: Date | null
}

export interface UnitCorrectionPlan {
  corrections: { id: string; from: { value: number; unit: string }; to: { value: number; unit: string } }[]
  /** Records whose unit cannot be converted. Left as they are, for a person. */
  unconvertible: { id: string; unit: string }[]
}

function canonicalOf(r: Pick<StoredRecord, 'value' | 'unit'>) {
  try {
    return canonicaliseMeasurement(r.value, r.unit)
  } catch (e) {
    if (e instanceof UnsupportedUnitError) return null
    throw e
  }
}

export function planUnitCorrections(records: StoredRecord[]): UnitCorrectionPlan {
  const plan: UnitCorrectionPlan = { corrections: [], unconvertible: [] }
  for (const r of records) {
    const to = canonicalOf(r)
    if (!to) {
      plan.unconvertible.push({ id: r.id, unit: r.unit })
      continue
    }
    if (to.unit === r.unit && to.value === r.value) continue
    plan.corrections.push({ id: r.id, from: { value: r.value, unit: r.unit }, to })
  }
  return plan
}

type Tx = Pick<Prisma.TransactionClient, 'dataRecord' | 'auditEntry'>

/**
 * Supersedes one record with its canonical form. Run inside runSerializable.
 * Returns null when there is nothing to do: the record is gone, inactive, or
 * already canonical — so re-running a correction is harmless.
 */
export async function applyUnitCorrection(
  tx: Tx,
  recordId: string,
): Promise<{ id: string; supersededBy: string } | null> {
  const r = (await tx.dataRecord.findFirst({
    where: { id: recordId, isActive: true },
  })) as StoredRecord | null
  if (!r) return null

  const to = canonicalOf(r)
  if (!to || (to.unit === r.unit && to.value === r.value)) return null

  const { recordId: successor } = await writeRecordWithAuditEntry(
    tx,
    {
      entityId: r.entityId,
      domain: r.domain,
      fieldName: r.fieldName,
      value: r.value,
      unit: r.unit,
      originalValue: r.originalValue,
      originalUnit: r.originalUnit,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      trustTier: r.trustTier,
      extractionMethod: r.extractionMethod,
      submittedById: r.submittedById,
      confidenceScore: r.confidenceScore,
      sourceText: r.sourceText ?? undefined,
      documentId: r.documentId ?? undefined,
      staleAfterDate: r.staleAfterDate,
    },
    'UNIT_CANONICALISED',
  )

  await tx.dataRecord.updateMany({
    where: { id: r.id, isActive: true },
    data: { isActive: false, supersededById: successor },
  })
  return { id: r.id, supersededBy: successor }
}
