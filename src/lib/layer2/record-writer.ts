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
import { computeRecordHash } from './audit-chain'
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
  /** Pre-normalisation value as entered or extracted. Defaults to value when omitted. */
  originalValue?: number
  /** Pre-normalisation unit. Defaults to unit when omitted. */
  originalUnit?: string
  periodStart: Date
  periodEnd: Date
  trustTier: TrustTier
  extractionMethod: ExtractionMethod
  submittedById: string
  confidenceScore?: number
  sourceText?: string
  documentId?: string
  isActive?: boolean
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
  const lastEntry = await tx.auditEntry.findFirst({
    where: { entityId: input.entityId },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })
  const previousHash = lastEntry?.hash ?? null

  const record = await tx.dataRecord.create({
    data: {
      entityId: input.entityId,
      domain: input.domain,
      fieldName: input.fieldName,
      value: input.value,
      unit: input.unit,
      originalValue: input.originalValue ?? input.value,
      originalUnit: input.originalUnit ?? input.unit,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      trustTier: input.trustTier,
      extractionMethod: input.extractionMethod,
      submittedById: input.submittedById,
      confidenceScore: input.confidenceScore ?? 1.0,
      sourceText: input.sourceText,
      documentId: input.documentId,
      isActive: input.isActive ?? true,
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
    trustTier: input.trustTier,
    submittedAt: new Date().toISOString(),
    submittedById: input.submittedById,
  }

  const hash = computeRecordHash(auditPayload, previousHash)

  await tx.dataRecord.update({
    where: { id: record.id },
    data: { auditHash: hash },
  })

  await tx.auditEntry.create({
    data: {
      entityId: input.entityId,
      recordId: record.id,
      eventType,
      payload: auditPayload as unknown as Prisma.InputJsonValue,
      hash,
      previousHash,
    },
  })

  return { recordId: record.id, hash }
}
