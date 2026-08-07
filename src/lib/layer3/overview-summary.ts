// Layer 3 — Access. Pure, read-only. No DB, no AI, no value transformation.
//
// The high-level position a company sees the moment it signs in: what its own
// documents say it used, made, moved and declared this year.
//
// This is a roll-up, not a calculation. It only ever adds like to like — same
// field, same unit, same reporting year — and it never crosses a unit boundary,
// applies a factor, or derives a figure from other figures. Gas in m³ and gas in
// kWh stay two separate lines, because turning one into the other needs a
// calorific value, and applying a factor is a calculation (PRD §14.3, §15.3).
// Every figure carries the composed tier of the records behind it, so a headline
// can never look more certain than its weakest contributing record.

import { composeTiers, type Tier, type TierComposition } from './tier-composition'
import { DOMAIN_LABELS } from '@/lib/domain-labels'

export interface PositionRecord {
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: Tier
  periodStart: Date | string
  periodEnd: Date | string
}

export interface HeadlineFigure {
  domain: string
  domainLabel: string
  fieldName: string
  /** Plain English name for the field — no underscores, no codes. */
  label: string
  /** Sum of the contributing records, all in the same unit. */
  total: number
  unit: string
  recordCount: number
  tierComposition: TierComposition
}

export interface OperationalPosition {
  /** Calendar year of the most recent record; null when there are no records. */
  reportingYear: number | null
  headlines: HeadlineFigure[]
  recordsInPeriod: number
  coveredDomains: string[]
  missingDomains: string[]
}

const ALL_DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

// The order a company (and the customer asking them) cares about. Declared
// emissions lead because that is the figure most often requested; the rest
// follow the shape of a manufacturing business: what you used, what you made,
// what went in, what moved, what was disposed of.
const DOMAIN_PRIORITY: Record<string, number> = {
  EMISSIONS: 0,
  ENERGY: 1,
  PRODUCTION: 2,
  MATERIALS: 3,
  LOGISTICS: 4,
  WASTE_AND_WATER: 5,
  AGRICULTURE: 6,
  COMPLIANCE: 7,
}

/** total_consumption_kwh → "Total consumption kwh". Never shows a raw code. */
function plainLabel(fieldName: string): string {
  const words = fieldName.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function yearOf(date: Date | string): number | null {
  const parsed = new Date(date)
  const year = parsed.getFullYear()
  return Number.isNaN(year) ? null : year
}

export function summariseOperationalPosition(records: PositionRecord[]): OperationalPosition {
  const usable = records.filter(r => typeof r.value === 'number' && Number.isFinite(r.value))

  const years = usable.map(r => yearOf(r.periodEnd)).filter((y): y is number => y !== null)
  if (years.length === 0) {
    return {
      reportingYear: null,
      headlines: [],
      recordsInPeriod: 0,
      coveredDomains: [],
      missingDomains: [...ALL_DOMAINS],
    }
  }

  const reportingYear = Math.max(...years)
  const inPeriod = usable.filter(r => yearOf(r.periodEnd) === reportingYear)

  // Group on domain + field + unit. The unit is part of the key precisely so two
  // units of the same field can never be added together.
  type Group = { domain: string; fieldName: string; unit: string; total: number; tiers: Tier[] }
  const groups = new Map<string, Group>()

  for (const r of inPeriod) {
    const key = `${r.domain}||${r.fieldName}||${r.unit}`
    let group = groups.get(key)
    if (!group) {
      group = { domain: r.domain, fieldName: r.fieldName, unit: r.unit, total: 0, tiers: [] }
      groups.set(key, group)
    }
    group.total += r.value
    group.tiers.push(r.trustTier)
  }

  const headlines: HeadlineFigure[] = [...groups.values()]
    .map(g => ({
      domain: g.domain,
      domainLabel: DOMAIN_LABELS[g.domain] ?? g.domain,
      fieldName: g.fieldName,
      label: plainLabel(g.fieldName),
      // Floating-point addition of stored values leaves long tails; round to a
      // sane number of places rather than showing 1999.9999999999998.
      total: Math.round(g.total * 10000) / 10000,
      unit: g.unit,
      recordCount: g.tiers.length,
      tierComposition: composeTiers(g.tiers),
    }))
    .sort((a, b) =>
      (DOMAIN_PRIORITY[a.domain] ?? 99) - (DOMAIN_PRIORITY[b.domain] ?? 99) ||
      b.recordCount - a.recordCount ||
      a.fieldName.localeCompare(b.fieldName),
    )

  const covered = new Set(inPeriod.map(r => r.domain))

  return {
    reportingYear,
    headlines,
    recordsInPeriod: inPeriod.length,
    coveredDomains: ALL_DOMAINS.filter(d => covered.has(d)),
    missingDomains: ALL_DOMAINS.filter(d => !covered.has(d)),
  }
}
