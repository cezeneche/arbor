// Upgrade 2 — active-learning review ranking. Pure: no DB, no network, no brain.
//
// Orders which field the human should confirm next by expected information gain,
// so SME review burden falls: Arbor asks about the fields whose confirmation
// tells it the most, and stops leading with fields it is already sure about.
//
// This runs on the review render path (user-facing), where the brain must never
// block — and binary entropy is a one-line formula, not heavy maths — so it
// lives here in TS. The brain owns the richer, offline information-theory work
// (mutual information for schema inference). The two share the same base-2 maths.
//
//   expected information gain = H(correctness) × importance
//
// H is the binary entropy of the field's correctness probability: a field the
// model is 50/50 on carries a full bit of uncertainty and is most worth asking;
// a near-certain field carries almost none. Importance scales that by how much
// the field matters downstream (compulsory > optional; a flag raises it).

export type Admissibility = 'COMPULSORY' | 'CONDITIONAL' | 'OPTIONAL'

/** Below this expected-gain a field carries little value to confirm; the UI may
 *  de-emphasise it (never hide it). */
export const LOW_INFO_GAIN = 0.15

const IMPORTANCE: Record<Admissibility, number> = {
  COMPULSORY: 1.0,
  CONDITIONAL: 0.6,
  OPTIONAL: 0.3,
}
const FLAG_BOOST = 0.3

export interface RankableField {
  fieldName: string
  /** The field's correctness probability (calibrated posterior mean, else raw score). */
  confidence: number
  admissibility: Admissibility
  flagged: boolean
  /** False when nothing was extracted for the field (always kept prominent). */
  hasValue: boolean
}

export interface RankedField extends RankableField {
  gain: number
  /** True when the field is confident, unimportant, present, and unflagged. */
  lowInformation: boolean
}

/** Binary (Bernoulli) entropy in bits. H(0) = H(1) = 0, H(0.5) = 1. */
export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))
}

/** How much the field matters downstream, in [0, ~1.3]. */
export function importanceWeight(admissibility: Admissibility, flagged: boolean): number {
  return IMPORTANCE[admissibility] + (flagged ? FLAG_BOOST : 0)
}

/** Expected information gain from asking the human to confirm this field. */
export function expectedInformationGain(field: RankableField): number {
  return binaryEntropy(field.confidence) * importanceWeight(field.admissibility, field.flagged)
}

/**
 * Rank fields by expected information gain, highest first (deterministic
 * field-name tie-break), flagging the low-information ones the UI can collapse.
 * A field is only ever low-information if it is present, unflagged, and its gain
 * is below the threshold — a missing or flagged field always stays prominent.
 */
export function rankReviewFields(fields: RankableField[]): RankedField[] {
  return fields
    .map(field => {
      const gain = expectedInformationGain(field)
      return {
        ...field,
        gain,
        lowInformation: field.hasValue && !field.flagged && gain < LOW_INFO_GAIN,
      }
    })
    .sort((a, b) => (b.gain === a.gain ? a.fieldName.localeCompare(b.fieldName) : b.gain - a.gain))
}
