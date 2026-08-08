// Layer 2 — Shared atomic record + audit entry writer.
//
// All record creation routes must go through this function.
// It ensures:
//   1. auditHash on DataRecord always matches the stored AuditEntry.hash
//   2. previousHash is fetched inside the transaction (not stale from before tx start)
//   3. Record + hash update + audit entry are a single atomic unit
//
// Call this inside prisma.$transaction(..., { isolationLevel: 'Serializable' })
// to prevent concurrent requests from corrupting the per-entity audit chain.
import { appendAuditEntry } from './audit-append'
import type { AuditPayload } from './audit-chain'
import type { DataDomain, TrustTier, ExtractionMethod, Prisma } from '@prisma/client'

type TxClient = Pick<
  Prisma.TransactionClient,
  'dataRecord' | 'auditEntry'
>

export interface RecordInput {
  entityId: string
  domain: DataDomain
  fieldName: string
  value: number
  unit: string
  /** Pre-normalisation value as entered or extracted. Must always be provided. */
  originalValue: number
  /** Pre-normalisation unit as entered or extracted. Must always be provided. */
  originalUnit: string
  periodStart: Date
  periodEnd: Date
  trustTier: TrustTier
  extractionMethod: ExtractionMethod
  submittedById: string
  confidenceScore?: number
  sourceText?: string
  documentId?: string
  isActive?: boolean
  /** batch/mill staleness horizon. Derived metadata, not part of the audit payload. */
  staleAfterDate?: Date | null
}

export interface RecordWriteResult {
  recordId: string
  hash: string
}

export async function writeRecordWithAuditEntry(
  tx: TxClient,
  input: RecordInput,
  eventType = 'CREATED',
): Promise<RecordWriteResult> {
  const record = await tx.dataRecord.create({
    data: {
      entityId: input.entityId,
      domain: input.domain,
      fieldName: input.fieldName,
      value: input.value,
      unit: input.unit,
      originalValue: input.originalValue,
      originalUnit: input.originalUnit,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      trustTier: input.trustTier,
      extractionMethod: input.extractionMethod,
      submittedById: input.submittedById,
      confidenceScore: input.confidenceScore ?? 1.0,
      sourceText: input.sourceText,
      documentId: input.documentId,
      isActive: input.isActive ?? true,
      staleAfterDate: input.staleAfterDate ?? null,
      auditHash: '',
    },
    select: { id: true },
  })

  const auditPayload: AuditPayload = {
    recordId: record.id,
    entityId: input.entityId,
    domain: input.domain,
    fieldName: input.fieldName,
    value: input.value,
    unit: input.unit,
    originalValue: input.originalValue,
    originalUnit: input.originalUnit,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    trustTier: input.trustTier,
    confidenceScore: input.confidenceScore ?? 1.0,
    sourceText: input.sourceText ?? null,
    documentId: input.documentId ?? null,
    extractionMethod: input.extractionMethod,
    submittedAt: new Date().toISOString(),
    submittedById: input.submittedById,
  }

  // appendAuditEntry reads the tail and claims the next position in one place, so
  // the ordering rule is not restated (and mis-stated) per write path.
  const { hash } = await appendAuditEntry(tx, {
    entityId: input.entityId,
    recordId: record.id,
    eventType,
    payload: auditPayload,
  })

  await tx.dataRecord.update({
    where: { id: record.id },
    data: { auditHash: hash },
  })

  return { recordId: record.id, hash }
}
