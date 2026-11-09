// The confirmation's writes: one serializable transaction. Records, their
// supersessions, withdrawals and the document's status commit together or not
// at all, so there is no partial state.
import { ExtractionMethod, type Prisma, type TrustTier } from '@prisma/client'
import { writeRecordWithAuditEntry } from '../record-writer'
import { planOwnRecordReplacement } from '../own-record-replacement'
import { buildWithdrawalPayload } from '../document-removal'
import { appendAuditEntry } from '../audit-append'
import { computeStaleAfterDate } from '../staleness'
import { enqueueCbamHandoff, type CbamHandoffInput } from '../cbam-handoff'
import { assertRecordCapacity } from '@/lib/plan-guard'
import { isPositionalField, type PreparedField } from './prepare'

export type SupersededScope = { domain: string; periodStart: Date; periodEnd: Date }

// Sentinels rather than returned errors, so a refusal aborts the transaction
// instead of half-writing. runSerializable rethrows anything that is not a
// write conflict, so they reach the route untouched.
export class AlreadyConfirmed extends Error {}
export class OverCapacity extends Error {
  constructor(readonly detail: string) {
    super(detail)
  }
}

export interface ConfirmationWrite {
  documentId: string
  entityId: string
  userId: string
  documentType: string
  cbamDocument: boolean
  prepared: readonly PreparedField[]
  trustTier: TrustTier
  onDuplicate: 'replace' | 'keep_both' | undefined
  /** Per field: the prior records the reviewer chose to replace. */
  replacePriorIds: Map<string, string[]>
  /** Recorded in the same transaction, so a confirmed CBAM document can never exist without it. */
  cbamHandoff: CbamHandoffInput | null
}

/**
 * Runs inside runSerializable, which reruns it after a write conflict.
 * Everything it decides comes back as its return value: state kept outside it
 * would carry over from an attempt that never committed.
 */
export async function writeConfirmation(
  tx: Prisma.TransactionClient,
  w: ConfirmationWrite,
): Promise<{ recordIds: string[]; supersededScopes: SupersededScope[] }> {
  const recordIds: string[] = []
  const supersededScopes: SupersededScope[] = []

  // The interactive confirm path wrote records without ever consulting the
  // plan cap. Counted inside the transaction that writes, so concurrent
  // confirmations cannot both take the last of the allowance.
  const capacity = await assertRecordCapacity(w.entityId, w.prepared.length, tx)
  if (!capacity.allowed) throw new OverCapacity(capacity.reason!)

  // Claim the document inside the transaction. The route's status check is a
  // fast path for the common case; on its own it left a window in which two
  // confirmations in flight together both passed it and both wrote a full set
  // of records.
  const claimed = await tx.document.updateMany({
    where: {
      id: w.documentId,
      entityId: w.entityId,
      OR: [
        { status: { notIn: ['ACCEPTED', 'WITHDRAWN'] } },
        { status: 'ACCEPTED', autoAcceptedAt: { not: null } },
      ],
    },
    data: { status: 'ACCEPTED', autoAcceptedAt: null },
  })
  if (claimed.count === 0) throw new AlreadyConfirmed()

  // Records this document already wrote — auto-accepted, or left behind when
  // the constraint gate sent it back to review — are replaced by this
  // confirmation, whatever the period or the duplicate choice.
  const own = await tx.dataRecord.findMany({
    where: { documentId: w.documentId, isActive: true },
    select: {
      id: true,
      entityId: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      originalValue: true,
      originalUnit: true,
      periodStart: true,
      periodEnd: true,
      trustTier: true,
      confidenceScore: true,
      sourceText: true,
      documentId: true,
      extractionMethod: true,
    },
  })
  const ownPlan = planOwnRecordReplacement(
    own,
    w.prepared.map(p => p.field.fieldName),
  )

  for (const { field, rawNum, siValue, siUnit, periodStart, periodEnd } of w.prepared) {
    // Supersede any existing active records for the same entity+domain+fieldName+period.
    // keep_both means exactly that: write alongside, supersede nothing.
    //
    // A positional goods-line field supersedes nothing either, for the same
    // reason it is not a duplicate candidate: matching on `lines[0].*` would
    // retire another shipment's first goods line because this document also
    // has one.
    const ownIds = ownPlan.supersedeByField.get(field.fieldName) ?? []
    const prior =
      w.onDuplicate === 'keep_both' || isPositionalField(w.cbamDocument, field.fieldName)
        ? ownIds.map(id => ({ id }))
        : await tx.dataRecord.findMany({
            where: {
              entityId: w.entityId,
              isActive: true,
              OR: [
                { domain: field.domain, fieldName: field.fieldName, periodStart, periodEnd },
                { id: { in: w.replacePriorIds.get(field.fieldName) ?? [] } },
                { id: { in: ownIds } },
              ],
            },
            select: { id: true },
          })

    const result = await writeRecordWithAuditEntry(
      tx,
      {
        entityId: w.entityId,
        domain: field.domain,
        fieldName: field.fieldName,
        value: siValue,
        unit: siUnit,
        originalValue: rawNum,
        originalUnit: field.confirmedUnit ?? 'unknown',
        periodStart,
        periodEnd,
        trustTier: w.trustTier,
        extractionMethod: ExtractionMethod.DOCUMENT_AI,
        submittedById: w.userId,
        documentId: w.documentId,
        sourceText: field.sourceText,
        confidenceScore: field.confidenceScore,
        staleAfterDate: computeStaleAfterDate(w.documentType, periodEnd),
      },
      'CREATED',
    )

    if (prior.length > 0) {
      await tx.dataRecord.updateMany({
        where: { id: { in: prior.map(p => p.id) } },
        data: { isActive: false, supersededById: result.recordId },
      })
      supersededScopes.push({ domain: field.domain, periodStart, periodEnd })
    }

    recordIds.push(result.recordId)
  }

  // An earlier record whose field the reviewer cleared: nothing replaces it,
  // and the figure it holds is one the reviewer says the document does not
  // state. Withdrawn, with its chain entry, rather than left standing.
  const ownById = new Map(own.map(r => [r.id, r]))
  for (const recordId of ownPlan.withdraw) {
    await appendAuditEntry(tx, {
      entityId: w.entityId,
      recordId,
      eventType: 'WITHDRAWN',
      payload: buildWithdrawalPayload(ownById.get(recordId)!, { at: new Date(), byId: w.userId }),
    })
    await tx.dataRecord.update({ where: { id: recordId }, data: { isActive: false } })
  }

  if (w.cbamHandoff) await enqueueCbamHandoff(tx, w.cbamHandoff)

  return { recordIds, supersededScopes }
}
