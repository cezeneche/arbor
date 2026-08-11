// Which extracted fields a document shows in the review queue.
//
// The queue used to keep only fields named in a fixed numeric set, and skip any
// document where none matched. That works for a meter reading and fails
// completely for a customs declaration, whose fields are named
// `lines[0].net_mass_kg` — a per-line name no fixed set can enumerate.
//
// The consequence was worse than a bad layout. A real customs declaration sat in
// REVIEW_REQUIRED with six extracted fields and never appeared in the queue: the
// document was simultaneously awaiting review and unreachable, while the screen
// told the user there was nothing to review. Nothing surfaced the contradiction
// because dropping the document was a silent `continue`.
//
// So: prefer the numeric fields, because they keep the queue tight and fast to
// confirm — but never return nothing for a document that has fields.

import { NUMERIC_FIELDS } from './review-policy'

export interface ReviewableField {
  fieldName: string
  rawValue: string | null
  rawUnit: string | null
  flagged: boolean
  flagReason: string | null
  sourceText: string
  confidenceScore: number
}

function hasValue(field: ReviewableField): boolean {
  return field.rawValue !== null && field.rawValue !== ''
}

export function selectReviewableFields(fields: ReviewableField[]): ReviewableField[] {
  const numeric = fields.filter(f => NUMERIC_FIELDS.has(f.fieldName) && hasValue(f))
  if (numeric.length > 0) return numeric

  // Fallback. A flagged field with no value is kept deliberately: "this
  // compulsory field was not found" is the most important thing a reviewer can
  // be told, and it has no value by definition. An unflagged empty field is
  // merely absent and carries nothing.
  return fields.filter(f => hasValue(f) || f.flagged)
}
