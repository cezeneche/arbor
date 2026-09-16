// Which confirmed fields become records, and which are only context.
//
// The confirm route takes two lists and they are not interchangeable. `fields`
// are measurements: each becomes a DataRecord with a value, a unit, a period, a
// trust tier and a place in the audit chain. `context` are the identifiers that
// say what the measurement is of — an importer's EORI, a commodity code, a
// country of origin — and they write nothing.
//
// Both review screens used to send one list. The batched queue sent every
// non-empty field as a measurement, so a customs declaration was refused with
// "this needs to be a number" against the importer's name. The per-document
// screen sent only the fixed numeric set, which no CBAM field is in, so it
// refused with "no numeric fields to confirm". Between them, a Nucleos-extracted
// document could not be confirmed by either route.
//
// Kept separate from `selectReviewableFields`, which answers a different
// question — what to SHOW. A CBAM document must show its identifiers, because
// correcting a wrong EORI is the whole reason a human is looking at it.
//
// Pure. No I/O.

import { NUMERIC_FIELDS } from './review-policy'
import { isCbamNumericFieldName } from '@/lib/nucleos/cbam-fields'

/**
 * Whether confirming this field writes a DataRecord.
 *
 * A list, not a look at the value: a CN code is eight digits and would parse as
 * a number perfectly well.
 */
export function isRecordProducingField(fieldName: string): boolean {
  return NUMERIC_FIELDS.has(fieldName) || isCbamNumericFieldName(fieldName)
}

export interface ConfirmSplit<T> {
  records: T[]
  context: T[]
}

/** Partition confirmed fields into the two lists the confirm route expects. */
export function splitConfirmFields<T extends { fieldName: string }>(
  fields: readonly T[],
): ConfirmSplit<T> {
  const records: T[] = []
  const context: T[] = []
  for (const field of fields) {
    ;(isRecordProducingField(field.fieldName) ? records : context).push(field)
  }
  return { records, context }
}
