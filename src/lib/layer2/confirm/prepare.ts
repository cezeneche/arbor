// The confirmed fields as the records they become, and what they could
// duplicate. Pure.
import { parseNumericValue } from '@/lib/parse-numeric'
import { isSupportedUnit, normaliseToSI } from '@/lib/layer3/unit-conversion'
import { parseGoodsLineFieldName } from '@/lib/nucleos/cbam-fields'
import type { ConfirmRequestField } from './request'

export interface PreparedField {
  field: ConfirmRequestField
  rawNum: number
  siValue: number
  siUnit: string
  periodStart: Date
  periodEnd: Date
}

export function prepareFields(fields: readonly ConfirmRequestField[]): PreparedField[] {
  return fields.map(field => {
    // validateConfirmFields has already established that every value parses and
    // every supplied unit is one normaliseToSI knows.
    const rawNum = parseNumericValue(field.confirmedValue)!
    const unit = field.confirmedUnit ?? 'unknown'
    const { value: siValue, siUnit } = isSupportedUnit(unit)
      ? normaliseToSI(rawNum, unit)
      : { value: rawNum, siUnit: unit }

    return {
      field,
      rawNum,
      siValue,
      siUnit,
      periodStart: new Date(field.periodStart),
      periodEnd: new Date(field.periodEnd),
    }
  })
}

/**
 * Whether a field's name says where it sits on the document rather than what it
 * is: a CBAM goods-line field.
 *
 * `lines[0].net_mass_kg` on one customs declaration and `lines[0].net_mass_kg`
 * on the next are different goods that happen to have been listed first, so
 * comparing them answers nothing in either direction: it reports a duplicate
 * between two unrelated shipments, and choosing "replace" would supersede a
 * real consignment's records and remove it from every total. It would also
 * miss the case it is meant to catch, since the same goods can arrive at a
 * different index. A document can only be confirmed once, so within one
 * document there is nothing to duplicate either.
 */
export function isPositionalField(cbamDocument: boolean, fieldName: string): boolean {
  return cbamDocument && parseGoodsLineFieldName(fieldName) !== null
}

/**
 * The fields to ask about before duplicating. The supersession inside the
 * transaction matches exactly on domain, field and both period boundaries; the
 * duplicate check is looser — same field, overlapping period — because that is
 * what the exact match misses, and a miss leaves two active records that
 * double-count on every total. Goods-line fields are left out.
 */
export function duplicateCandidates(prepared: readonly PreparedField[], cbamDocument: boolean) {
  return prepared
    .filter(({ field }) => !isPositionalField(cbamDocument, field.fieldName))
    .map(({ field, periodStart, periodEnd }) => ({
      fieldName: field.fieldName,
      domain: field.domain,
      periodStart,
      periodEnd,
    }))
}
