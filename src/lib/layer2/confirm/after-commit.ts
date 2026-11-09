// What follows a committed confirmation. Each step is best-effort: the records
// are certified and chained, and nothing here may roll them back or fail the
// request. A step that fails is logged and the next one still runs.
import type { DataDomain, GroundTruthSource, TrustTier } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runCrossValidation } from '@/lib/validation/cross-validation'
import { runConstraintValidation } from '@/lib/constraints/run-constraint-validation'
import { buildReviewLabels, type ExtractedFieldLite } from '@/lib/confidence/review-capture'
import { findActiveGranteeEntityIds } from '@/lib/layer3/grant-access'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { notifyBuyersOfSupersession } from '@/lib/supersession-notice'
import { logError } from '@/lib/log'
import { runCbamHandoff, type CbamHandoffOutcome } from '../cbam-handoff'
import type { PreparedField } from './prepare'
import type { ConfirmRequestField } from './request'
import type { SupersededScope } from './write'

interface ExtractionJobRead {
  documentClass: string | null
  extractorVersion: string | null
  extractedFields: ExtractedFieldLite[]
}

export interface CommittedConfirmation {
  documentId: string
  entityId: string
  documentType: string
  requestId: string | null
  job: ExtractionJobRead | undefined
  fields: readonly ConfirmRequestField[]
  prepared: readonly PreparedField[]
  recordIds: readonly string[]
  supersededScopes: readonly SupersededScope[]
  trustTier: TrustTier
  /** Whether a CBAM handoff was recorded in the transaction. */
  cbamHandoff: boolean
}

/** Runs every after-commit step. Returns the CBAM handoff's outcome, when there was one. */
export async function afterConfirm(c: CommittedConfirmation): Promise<CbamHandoffOutcome | null> {
  const log = (message: string, e: unknown) => logError(message, e, { requestId: c.requestId })

  // Cross-validation runs after commit — it reads accepted records and writes CV results.
  // Failures here do not roll back the confirmation (warnings only, not blocking).
  await runCrossValidation(c.entityId, c.documentId, c.documentType).catch(e =>
    log('confirm: runCrossValidation failed', e),
  )

  // algebraic-constraint intake flagging: raise non-blocking
  // ValidationFlags for physically impossible / fraudulent records (mass
  // balance, non-negativity, implausible sector intensity). Post-commit,
  // fail-soft — the brain must never block or roll back a confirmation.
  await runConstraintValidation(c.documentId).catch(e => log('confirm: runConstraintValidation failed', e))

  try {
    await recordGroundTruth(c)
  } catch (e) {
    log('confirm: ground-truth label capture failed', e)
  }

  // notify any buyer with active access that a record they can see was
  // corrected. Non-fatal.
  try {
    await notifyBuyersOfSupersession(c.entityId, c.supersededScopes)
  } catch (e) {
    log('confirm: supersession notification failed', e)
  }

  if (c.trustTier === 'A' && c.prepared.length > 0) {
    try {
      await announceCertified(c)
    } catch (e) {
      log('confirm: record.certified webhook failed', e)
    }
  }

  // The CBAM handoff: a confirmed customs declaration, supplier invoice or CBAM
  // declaration becomes a case in Nucleos. Without this the CBAM screens read a
  // list nothing could fill — every case in them arrived by hand.
  //
  // Post-commit and never fatal. The records above are certified and chained;
  // a boundary that is down must not undo that. What it must not do either is
  // stay quiet, so the outcome travels back in the response and the failure is
  // written to the link row where the CBAM screens can show it.
  //
  // Run straight away, so the common case opens the case within this request.
  // A failure here leaves the row FAILED or PARTIAL with its progress recorded,
  // and Resume on the CBAM page — or the sweep — finishes it.
  if (!c.cbamHandoff) return null
  try {
    return await runCbamHandoff(c.documentId)
  } catch (e) {
    log('confirm: CBAM case handoff failed', e)
    return {
      attempted: true,
      caseId: null,
      status: 'PENDING',
      problems: ['The case has not been opened yet. Your figures are saved, and Arbor will retry.'],
    }
  }
}

// capture calibration ground truth: compare what the reviewer
// confirmed against what the model extracted, one GroundTruthLabel per
// AI-extracted field. Best-effort and post-commit — training signal must
// never roll back or block a confirmation.
async function recordGroundTruth(c: CommittedConfirmation): Promise<void> {
  if (!c.job) return
  const recordIdByField: Record<string, string | null> = {}
  c.prepared.forEach((p, i) => {
    recordIdByField[p.field.fieldName] = c.recordIds[i] ?? null
  })
  const labels = buildReviewLabels({
    entityId: c.entityId,
    documentId: c.documentId,
    documentClass: c.job.documentClass ?? c.documentType,
    extractorVersion: c.job.extractorVersion ?? null,
    extractedFields: c.job.extractedFields.map(f => ({
      fieldName: f.fieldName,
      rawValue: f.rawValue,
      confidenceScore: f.confidenceScore,
      admissibility: f.admissibility,
      flagged: f.flagged,
    })),
    confirmedFields: c.fields.map(f => ({
      fieldName: f.fieldName,
      confirmedValue: f.confirmedValue,
      domain: f.domain,
    })),
    recordIdByField,
  })
  if (labels.length === 0) return
  await prisma.groundTruthLabel.createMany({
    data: labels.map(l => ({
      entityId: l.entityId,
      documentId: l.documentId,
      recordId: l.recordId,
      fieldName: l.fieldName,
      documentClass: l.documentClass,
      domain: l.domain as DataDomain,
      extractedValue: l.extractedValue,
      confirmedValue: l.confirmedValue,
      wasCorrect: l.wasCorrect,
      confidenceAtExtraction: l.confidenceAtExtraction,
      source: l.source as GroundTruthSource,
      expectedInformationGain: l.expectedInformationGain,
      lowInformation: l.lowInformation,
      extractorVersion: l.extractorVersion,
    })),
  })
}

// fire record.certified webhooks for newly written Tier A records to
// any buyer with active access covering that scope.
async function announceCertified(c: CommittedConfirmation): Promise<void> {
  const certifiedScopes = new Map<string, { domain: string; periodStart: Date; periodEnd: Date }>()
  for (const { field, periodStart, periodEnd } of c.prepared) {
    certifiedScopes.set(`${field.domain}:${periodStart.toISOString()}:${periodEnd.toISOString()}`, {
      domain: field.domain,
      periodStart,
      periodEnd,
    })
  }
  const fired = new Set<string>()
  for (const scope of certifiedScopes.values()) {
    const grantees = await findActiveGranteeEntityIds(
      c.entityId,
      scope.domain,
      scope.periodStart,
      scope.periodEnd,
    )
    for (const granteeEntityId of grantees) {
      const key = `${granteeEntityId}:${scope.domain}`
      if (fired.has(key)) continue
      fired.add(key)
      await dispatchWebhook(granteeEntityId, 'record.certified', {
        supplierEntityId: c.entityId,
        domain: scope.domain,
        trustTier: 'A',
        periodStart: scope.periodStart.toISOString(),
        periodEnd: scope.periodEnd.toISOString(),
      })
    }
  }
}
