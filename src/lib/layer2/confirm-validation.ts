// Layer 2 — admissibility of a confirmation payload, decided before anything is
// written. Pure: no DB, no AI, no side effects.
//
// A confirmation is the moment a probabilistic extraction becomes a permanent,
// hash-chained record, so it is the last point at which anything can be refused.
// The route used to skip whatever it could not parse and accept the document
// regardless — a payload of entirely unusable values produced an ACCEPTED
// document with no records behind it, and the user was told it had been saved.
import { parseNumericValue } from '@/lib/parse-numeric'
import { isSupportedUnit } from '@/lib/layer3/unit-conversion'

export interface ConfirmField {
  fieldName: string
  confirmedValue: string
  confirmedUnit?: string
  periodStart: string
  periodEnd: string
}

export type ConfirmFieldProblem =
  | 'not_a_number'
  | 'period_end_not_after_start'
  | 'unknown_field'
  | 'unsupported_unit'
  | 'duplicate_field_period'

export interface ConfirmFieldError {
  fieldName: string
  problem: ConfirmFieldProblem
  message: string
}

const MESSAGES: Record<ConfirmFieldProblem, string> = {
  not_a_number: 'This needs to be a number.',
  period_end_not_after_start: 'The end of the period must come after the start.',
  unknown_field: 'This is not a field Arbor reads from this kind of document.',
  unsupported_unit: 'Arbor does not recognise this unit, so it could not convert the figure later.',
  duplicate_field_period: 'The same field is given twice for the same period.',
}

export interface ValidateConfirmOptions {
  /** Field names the document type defines. Empty means "no definition on file",
   *  in which case field names are not checked rather than all being rejected. */
  knownFieldNames?: ReadonlySet<string>
}

/** Every problem in the payload, not just the first — the reviewer should be able
 *  to fix the whole form in one pass rather than one field per round trip. */
export function validateConfirmFields(
  fields: readonly ConfirmField[],
  opts: ValidateConfirmOptions = {},
): ConfirmFieldError[] {
  const errors: ConfirmFieldError[] = []
  const fail = (fieldName: string, problem: ConfirmFieldProblem) =>
    errors.push({ fieldName, problem, message: MESSAGES[problem] })

  const seen = new Set<string>()

  for (const field of fields) {
    if (opts.knownFieldNames?.size && !opts.knownFieldNames.has(field.fieldName)) {
      fail(field.fieldName, 'unknown_field')
    }

    const parsed = parseNumericValue(field.confirmedValue)
    if (parsed === null || Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      fail(field.fieldName, 'not_a_number')
    }

    // A unit that cannot be normalised cannot be converted on output either, and
    // Layer 3's promise is that any recipient can ask for their own units. An
    // absent unit is a different thing: no unit was claimed.
    if (field.confirmedUnit && !isSupportedUnit(field.confirmedUnit)) {
      fail(field.fieldName, 'unsupported_unit')
    }

    const start = Date.parse(field.periodStart)
    const end = Date.parse(field.periodEnd)
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      fail(field.fieldName, 'period_end_not_after_start')
    }

    const key = `${field.fieldName}|${field.periodStart}|${field.periodEnd}`
    if (seen.has(key)) fail(field.fieldName, 'duplicate_field_period')
    seen.add(key)
  }

  return errors
}

/** Tier A requires every compulsory field for the document type to be present
 *  (admissibility spec §Tier Summary).
 *
 *  Presence is judged on the effective document — what the extraction found, with
 *  the reviewer's corrections applied on top — not on the raw extraction alone.
 *  Deriving it from the extraction only meant a reviewer could blank a compulsory
 *  field and the records still came out Verified.
 */
export function deriveTrustTier(input: {
  /** null/'' means the extraction did not find the field. */
  extracted: ReadonlyMap<string, string | null>
  /** Field name → the value the reviewer confirmed. */
  confirmed: ReadonlyMap<string, string>
  compulsory: ReadonlySet<string>
  /** No extraction job at all — nothing was read from a document. */
  hasExtraction: boolean
}): 'A' | 'B' {
  if (!input.hasExtraction) return 'B'

  for (const name of input.compulsory) {
    const corrected = input.confirmed.get(name)
    const effective = corrected !== undefined ? corrected : input.extracted.get(name)
    if (effective === null || effective === undefined || effective.trim() === '') return 'B'
  }

  return 'A'
}
