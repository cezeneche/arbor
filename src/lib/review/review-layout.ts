// The review grid, decided before it is rendered. Pure: no DB, no network.
//
// The screen used to draw a separate grid per requirement level — compulsory,
// conditional, optional — so a document with 9 + 1 + 2 fields left a hole beside
// the ninth compulsory field and another beside the only conditional one.
// Twelve fields that should fill six complete rows filled eight ragged ones.
//
// One grid over every field fixes that, and the requirement level moves onto the
// card so nothing is lost with the headings. The order still says the same thing
// the headings did — compulsory, then conditional, then optional — and within
// each group the information-gain ranking still leads with the field worth
// asking about. Ranking orders; it never promotes a field out of its group,
// because what a field is required for outranks how unsure we are about it.

import { rankReviewFields, type Admissibility } from './information-gain'

export interface LayoutField {
  fieldName: string
  admissibility: Admissibility
  /** Correctness probability — drives the order within a group, nothing else. */
  confidence: number
  flagged: boolean
  /** False when nothing was extracted for the field. */
  hasValue: boolean
}

export interface LaidOutField extends LayoutField {
  /** True when this card should span the full width to close a short row. */
  spansRow: boolean
}

/** The grid is two columns; a row is complete when it holds two cards. */
export const REVIEW_COLUMNS = 2

const GROUP_ORDER: Admissibility[] = ['COMPULSORY', 'CONDITIONAL', 'OPTIONAL']

/**
 * Order every field for a single two-column grid, and mark the one card that
 * needs to stretch when the count is odd — so the last row is never half empty.
 */
export function layoutReviewFields(fields: LayoutField[]): LaidOutField[] {
  const ordered: LayoutField[] = []

  for (const group of GROUP_ORDER) {
    const inGroup = fields.filter(f => f.admissibility === group)
    if (inGroup.length === 0) continue

    const ranked = rankReviewFields(inGroup)
    const byName = new Map(inGroup.map(f => [f.fieldName, f]))
    for (const r of ranked) {
      const field = byName.get(r.fieldName)
      if (field) ordered.push(field)
    }
  }

  const remainder = ordered.length % REVIEW_COLUMNS
  return ordered.map((field, i) => ({
    ...field,
    spansRow: remainder !== 0 && i === ordered.length - 1,
  }))
}
