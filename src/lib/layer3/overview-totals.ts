// Layer 3 — Access. Pure, read-only. §5: the four figures for the declaration
// year.
//
// Two rules carry this module.
//
// Nothing is summed across units. arbor does not convert on read, so where
// records inside one figure disagree the majority unit is summed and the
// remainder is reported as a conflict — visible, not silently folded in.
//
// Total emissions is a placeholder by design, not by omission. arbor stores
// declared figures and does not compute a footprint (PRD §14.3, §25), so the
// figure names what it would need instead of showing a partial sum that no
// record id could account for.

import { meetTier, type Tier } from './tier-composition'

export interface TotalRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: Tier
  periodEnd: Date | string
}

export type TotalKey = 'energy' | 'weight' | 'materials' | 'emissions'

export interface OverviewTotal {
  key: TotalKey
  label: string
  /** null renders as an em-dash; never as zero. */
  value: number | null
  unit: string | null
  /** Weakest tier among the contributing records. */
  tier: Tier | null
  recordIds: string[]
  /** Records excluded because they were recorded in a different unit. */
  conflictCount: number
  /** Set only when the figure is deliberately not computed. */
  placeholderReason?: string
}

// Which stored fields feed which figure. Nothing here crosses a record type.
const SOURCES: Record<Exclude<TotalKey, 'emissions'>, { label: string; fields: string[] }> = {
  energy: {
    label: 'Energy consumed',
    fields: ['total_consumption_kwh', 'total_consumption_m3', 'energy_consumption', 'energy_consumption_total'],
  },
  weight: {
    label: 'Weight declared',
    fields: ['shipment_weight', 'declared_weight', 'gross_weight', 'quantity_tonnes'],
  },
  materials: {
    label: 'Materials input',
    fields: ['quantity', 'quantity_produced'],
  },
}

function yearOf(date: Date | string): number | null {
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear()
}

function summarise(
  key: Exclude<TotalKey, 'emissions'>,
  records: TotalRecord[],
): OverviewTotal {
  const { label, fields } = SOURCES[key]
  const relevant = records.filter(r => fields.includes(r.fieldName))

  if (relevant.length === 0) {
    return { key, label, value: null, unit: null, tier: null, recordIds: [], conflictCount: 0 }
  }

  // The unit most of the records agree on. Anything else is a conflict, not a
  // term to convert and add.
  const byUnit = new Map<string, TotalRecord[]>()
  for (const r of relevant) {
    const unit = r.unit.trim().toLowerCase()
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), r])
  }
  const [, agreeing] = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)[0]

  return {
    key,
    label,
    value: Math.round(agreeing.reduce((sum, r) => sum + r.value, 0) * 10000) / 10000,
    unit: agreeing[0].unit,
    tier: agreeing.map(r => r.trustTier).reduce<Tier>((acc, t) => meetTier(acc, t), 'A'),
    recordIds: agreeing.map(r => r.id),
    conflictCount: relevant.length - agreeing.length,
  }
}

export function buildOverviewTotals(records: TotalRecord[], year: number): OverviewTotal[] {
  const inYear = records.filter(r => yearOf(r.periodEnd) === year)

  const emissionsMissing: string[] = []
  if (!inYear.some(r => SOURCES.energy.fields.includes(r.fieldName))) {
    emissionsMissing.push(`${year} energy`)
  }
  // arbor holds no factor set, and applying one would be a calculation.
  emissionsMissing.push('an emission factor set')

  return [
    summarise('energy', inYear),
    summarise('weight', inYear),
    summarise('materials', inYear),
    {
      key: 'emissions',
      label: 'Total emissions',
      value: null,
      unit: null,
      tier: null,
      recordIds: [],
      conflictCount: 0,
      placeholderReason: `Needs ${emissionsMissing.join(' and ')}`,
    },
  ]
}
