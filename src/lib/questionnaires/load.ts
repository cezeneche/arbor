// Layer 3 adapter between stored DataRecords (held in SI base units)
// and the pure prefill function (which sums identical units). Pure: no DB reads,
// no AI. The only transform is a unit conversion on OUTPUT — explicitly allowed
// in Layer 3 — so each question sees its records already in its target unit.

import { convertFromSI, isSupportedUnit, type SIDimension, type SupportedUnit } from '@/lib/layer3/unit-conversion'
import type { PrefillInputRecord } from './prefill'
import type { QuestionnaireTemplate } from './types'

export interface StoredRecordForPrefill {
  id: string
  domain: string
  fieldName: string
  /** Stored SI value. */
  value: number
  /** Stored SI unit (e.g. 'mj', 'kg', 'm3'). */
  unit: string
  trustTier: 'A' | 'B' | 'C'
  periodStart: Date | string
  periodEnd: Date | string
}

/**
 * Convert stored SI records into the unit each template question expects, so the
 * pure prefill function only ever sums identical units. A record is converted
 * when a question references its (domain, fieldName) with a declared target unit
 * and the conversion is dimensionally valid; otherwise it is passed through
 * unchanged (it simply will not unit-match a declared-unit question).
 */
export function toPrefillRecords(
  template: QuestionnaireTemplate,
  stored: StoredRecordForPrefill[],
): PrefillInputRecord[] {
  // (domain|fieldName) → target unit declared by the template.
  const targetUnitByKey = new Map<string, string>()
  for (const q of template.questions) {
    if (q.unit) targetUnitByKey.set(`${q.domain}|${q.fieldName}`, q.unit)
  }

  return stored.map((r) => {
    const target = targetUnitByKey.get(`${r.domain}|${r.fieldName}`)
    if (target && target !== r.unit && isSupportedUnit(r.unit) && isSupportedUnit(target)) {
      try {
        const { convertedValue } = convertFromSI(r.value, r.unit as SIDimension, target as SupportedUnit)
        return { ...normalisePeriods(r), value: convertedValue, unit: target }
      } catch {
        // Incompatible dimensions — leave the record in its stored unit.
        return normalisePeriods(r)
      }
    }
    return normalisePeriods(r)
  })
}

function normalisePeriods(r: StoredRecordForPrefill): PrefillInputRecord {
  return {
    id: r.id,
    domain: r.domain,
    fieldName: r.fieldName,
    value: r.value,
    unit: r.unit,
    trustTier: r.trustTier,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
  }
}
