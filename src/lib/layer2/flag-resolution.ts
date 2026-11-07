// Layer 2 — a supplier settles a flag on one of their own records.
//
// keep    — the value stands. The flag is resolved with the supplier's note and
//           the note is chained as a FLAG_ACCEPTED event (PRD 12.3 "Accepted").
//           Refused for a critical flag: the admissibility spec resolves those
//           with evidence, so the supplier corrects or uploads instead.
// correct — a new record supersedes the old one (PRD 20.3), Declared because a
//           typed value has no document behind it. The old record stays,
//           inactive, and its open flags close with it.
//
// Neither changes the tier of an existing record; tiers are set at write time.
// Run inside runSerializable: both paths append to the entity's audit chain.
import type { DataDomain, ExtractionMethod, Prisma, Severity, TrustTier } from '@prisma/client'
import type { AuditPayload } from './audit-chain'
import { appendAuditEntry } from './audit-append'
import { writeRecordWithAuditEntry } from './record-writer'
import { shownMeasurement } from '@/lib/shown-measurement'

export interface FlaggedRecord {
  id: string
  entityId: string
  isActive: boolean
  domain: DataDomain
  fieldName: string
  value: number
  unit: string
  /** Null on records written before originals were kept; see shown-measurement. */
  originalValue: number | null
  originalUnit: string | null
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

export interface OpenFlag {
  id: string
  severity: Severity
  flagType: string
  dataRecord: FlaggedRecord
}

export type FlagResolutionRequest = { action: 'keep'; note: string } | { action: 'correct'; value: number }

export type FlagRefusal = 'NOT_FOUND' | 'NOTE_REQUIRED' | 'NEEDS_EVIDENCE' | 'INVALID_VALUE' | 'UNCHANGED'

export type FlagResolutionResult =
  | { ok: true; action: 'kept' }
  | {
      ok: true
      action: 'corrected'
      recordId: string
      scope: { domain: DataDomain; periodStart: Date; periodEnd: Date }
    }
  | { ok: false; reason: FlagRefusal }

export const MAX_NOTE_LENGTH = 1000

export function checkFlagResolution(
  flag: OpenFlag | null,
  request: FlagResolutionRequest,
): FlagRefusal | null {
  if (!flag) return 'NOT_FOUND'
  if (request.action === 'keep') {
    if (flag.severity === 'CRITICAL') return 'NEEDS_EVIDENCE'
    return request.note.trim() === '' ? 'NOTE_REQUIRED' : null
  }
  if (!Number.isFinite(request.value)) return 'INVALID_VALUE'
  // Compared in the unit the supplier was shown, which is the one they typed in.
  return request.value === shownMeasurement(flag.dataRecord).value ? 'UNCHANGED' : null
}

type Tx = Pick<Prisma.TransactionClient, 'validationFlag' | 'dataRecord' | 'auditEntry'>

const RECORD_SELECT = {
  id: true,
  entityId: true,
  isActive: true,
  domain: true,
  fieldName: true,
  value: true,
  unit: true,
  originalValue: true,
  originalUnit: true,
  periodStart: true,
  periodEnd: true,
  trustTier: true,
  extractionMethod: true,
  submittedById: true,
  confidenceScore: true,
  sourceText: true,
  documentId: true,
  staleAfterDate: true,
} as const

export async function resolveFlag(
  tx: Tx,
  input: { flagId: string; entityId: string; userId: string; request: FlagResolutionRequest; now: Date },
): Promise<FlagResolutionResult> {
  // Only an open flag on an active record of the caller's own organisation:
  // anything else is reported as not found, so other tenants' flags stay unseen.
  const flag = (await tx.validationFlag.findFirst({
    where: { id: input.flagId, resolvedAt: null, dataRecord: { entityId: input.entityId, isActive: true } },
    select: { id: true, severity: true, flagType: true, dataRecord: { select: RECORD_SELECT } },
  })) as OpenFlag | null

  const refusal = checkFlagResolution(flag, input.request)
  if (refusal || !flag) return { ok: false, reason: refusal ?? 'NOT_FOUND' }
  const r = flag.dataRecord
  const shown = shownMeasurement(r)

  if (input.request.action === 'keep') {
    const note = input.request.note.trim().slice(0, MAX_NOTE_LENGTH)
    // A non-record event, namespaced like the verifier's, so it never stands in
    // for the record's own entry. It carries the record as it stands and the note.
    const payload: AuditPayload = {
      recordId: `flag_${flag.id}`,
      entityId: r.entityId,
      domain: r.domain,
      fieldName: r.fieldName,
      value: r.value,
      unit: r.unit,
      originalValue: shown.value,
      originalUnit: shown.unit,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      trustTier: r.trustTier,
      confidenceScore: r.confidenceScore,
      sourceText: note,
      documentId: r.documentId,
      extractionMethod: r.extractionMethod,
      submittedAt: input.now.toISOString(),
      submittedById: input.userId,
    }
    await appendAuditEntry(tx, {
      entityId: r.entityId,
      recordId: payload.recordId,
      eventType: 'FLAG_ACCEPTED',
      payload,
    })
    await tx.validationFlag.updateMany({
      where: { id: flag.id, resolvedAt: null },
      data: { resolvedAt: input.now, resolvedNote: note },
    })
    return { ok: true, action: 'kept' }
  }

  const { recordId } = await writeRecordWithAuditEntry(
    tx,
    {
      entityId: r.entityId,
      domain: r.domain,
      fieldName: r.fieldName,
      value: input.request.value,
      unit: shown.unit,
      originalValue: input.request.value,
      originalUnit: shown.unit,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      trustTier: 'B',
      extractionMethod: 'MANUAL_ENTRY',
      submittedById: input.userId,
      confidenceScore: 1.0,
      staleAfterDate: r.staleAfterDate,
    },
    'CORRECTED',
  )
  await tx.dataRecord.updateMany({
    where: { id: r.id, isActive: true },
    data: { isActive: false, supersededById: recordId },
  })
  await tx.validationFlag.updateMany({
    where: { dataRecordId: r.id, resolvedAt: null },
    data: { resolvedAt: input.now, resolvedNote: 'Corrected: replaced by a new record.' },
  })
  return {
    ok: true,
    action: 'corrected',
    recordId,
    scope: { domain: r.domain, periodStart: r.periodStart, periodEnd: r.periodEnd },
  }
}
