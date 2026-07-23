// Buyer-side learning signal (pure; no DB, no AI). Turns a buyer's confirm/dispute
// on a shared record into a GroundTruthLabel.
//
// Buyers consume supplier data; when they say "this figure is wrong" they are
// surfacing a real extraction/data-quality signal the platform otherwise throws
// away. We capture it — but tag it with a buyer source so it is distinguishable
// from the data owner's authoritative review labels. A buyer is a third party,
// not the owner of the fact, so this signal drives the correction loop (flag +
// notification, done by the route) and accumulates for later use, but is
// deliberately kept out of the calibration fit that maps confidence -> P(correct).
//
// Immutability: this never mutates the certified record. If the supplier agrees,
// they correct it through the normal supersession flow.

import type { GroundTruthLabelInput } from './ground-truth'

export type BuyerDecision = 'confirm' | 'dispute'

export interface BuyerSignalInput {
  /** The data owner (supplier) the record belongs to. */
  entityId: string
  documentId: string | null
  recordId: string
  fieldName: string
  documentClass: string
  domain: string
  /** The current stored value the buyer is judging, stringified. */
  recordValue: string | null
  /** The buyer's proposed correct value on a dispute. Optional. */
  suggestedValue?: string | null
  /** The record's confidence at extraction, paired with the outcome. */
  confidenceAtExtraction: number
  /** The extractor (model + prompt version) that produced the record, if known. */
  extractorVersion?: string | null
  decision: BuyerDecision
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

export function buildBuyerLabel(input: BuyerSignalInput): GroundTruthLabelInput {
  const confirmed = input.decision === 'confirm'
  return {
    entityId: input.entityId,
    documentId: input.documentId,
    recordId: input.recordId,
    fieldName: input.fieldName,
    documentClass: input.documentClass,
    domain: input.domain,
    extractedValue: input.recordValue,
    // Confirm vouches for the stored value; dispute records the buyer's proposed
    // correction (or null if they only flagged it as wrong).
    confirmedValue: confirmed ? input.recordValue : input.suggestedValue ?? null,
    wasCorrect: confirmed,
    confidenceAtExtraction: clamp01(input.confidenceAtExtraction),
    source: confirmed ? 'BUYER_CONFIRMED' : 'BUYER_DISPUTED',
    // Buyer labels are not produced by the review UI, so they carry no ranking signal.
    expectedInformationGain: null,
    lowInformation: null,
    extractorVersion: input.extractorVersion ?? null,
  }
}
