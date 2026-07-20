// calibration training signal (pure; no DB, no AI, no side effects).
//
// Every human review decision on a single field becomes one labelled datapoint:
// the model's confidence at extraction time paired with whether its extracted
// value was actually correct (survived review unchanged). The brain's
// POST /calibration/fit consumes a stream of these to fit the calibration map
// and compute ECE / Brier / reliability curves per field type + document class.
//
// This module is the pure mapping from a review decision to the row we persist
// into the GroundTruthLabel table. Persistence itself is a thin Layer 2 write
// performed by the review flow; the correctness logic lives — and is tested —
// here.

export type GroundTruthSource = 'REVIEW_CONFIRMED' | 'REVIEW_CORRECTED'

export interface ReviewFieldDecision {
  entityId: string
  documentId: string | null
  /** The DataRecord written from this field, if any (null when corrected-and-discarded). */
  recordId?: string | null
  fieldName: string
  /** Typed DocumentType value, or the schema-on-read class for GENERIC docs. */
  documentClass: string
  domain: string
  /** The model's extracted value (null if the model found nothing). */
  extractedValue: string | null
  /** The value after review (null if the reviewer cleared it). */
  confirmedValue: string | null
  /** The uncalibrated model score for this field at extraction time. */
  confidenceAtExtraction: number
  /** The expected information gain the review UI ranked this field
   *  by, and whether it was de-emphasised as low-information. Null when unknown. */
  expectedInformationGain?: number | null
  lowInformation?: boolean | null
  /** The extractor (model + prompt version) that produced this field, so a later
   *  accuracy regression is attributable. Null for pre-stamping labels. */
  extractorVersion?: string | null
}

export interface GroundTruthLabelInput {
  entityId: string
  documentId: string | null
  recordId: string | null
  fieldName: string
  documentClass: string
  domain: string
  extractedValue: string | null
  confirmedValue: string | null
  wasCorrect: boolean
  confidenceAtExtraction: number
  source: GroundTruthSource
  /** The ranking signal, correlated later with wasCorrect. */
  expectedInformationGain: number | null
  lowInformation: boolean | null
  /** The extractor (model + prompt version) that produced this field. */
  extractorVersion: string | null
}

/** Normalise a value for the "did it survive review" comparison. */
function normaliseText(v: string | null): string {
  return (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Parse a value as a number, tolerating thousands separators. Returns null if not numeric. */
function asNumber(v: string): number | null {
  if (v === '') return null
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Did the model's extracted value survive review unchanged? Cosmetic
 * normalisation (whitespace, case, thousands separators) is not a correction;
 * numeric values are compared numerically. Two empties match (the model
 * correctly found nothing).
 */
export function valuesMatch(extracted: string | null, confirmed: string | null): boolean {
  const a = normaliseText(extracted)
  const b = normaliseText(confirmed)
  if (a === b) return true

  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null) return na === nb

  return false
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/** Map a single field's review decision to the ground-truth label we persist. */
export function buildGroundTruthLabel(decision: ReviewFieldDecision): GroundTruthLabelInput {
  const wasCorrect = valuesMatch(decision.extractedValue, decision.confirmedValue)
  return {
    entityId: decision.entityId,
    documentId: decision.documentId,
    recordId: decision.recordId ?? null,
    fieldName: decision.fieldName,
    documentClass: decision.documentClass,
    domain: decision.domain,
    extractedValue: decision.extractedValue,
    confirmedValue: decision.confirmedValue,
    wasCorrect,
    confidenceAtExtraction: clamp01(decision.confidenceAtExtraction),
    source: wasCorrect ? 'REVIEW_CONFIRMED' : 'REVIEW_CORRECTED',
    expectedInformationGain: decision.expectedInformationGain ?? null,
    lowInformation: decision.lowInformation ?? null,
    extractorVersion: decision.extractorVersion ?? null,
  }
}
