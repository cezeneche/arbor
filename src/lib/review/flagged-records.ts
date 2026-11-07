// Review's second list: saved records with an open flag, as a supplier reads
// them. Pure. The value is the one they entered or uploaded, not the stored SI
// form, because a correction is typed in that same unit (shown-measurement).
import { fieldLabel } from '@/lib/layer3/field-label'
import { shownMeasurement } from '@/lib/shown-measurement'

export interface FlaggedRecordRow {
  id: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  message: string
  dueAt: Date | null
  dataRecord: {
    domain: string
    fieldName: string
    value: number
    unit: string
    originalValue: number | null
    originalUnit: string | null
    periodStart: Date
    periodEnd: Date
  }
}

export interface FlaggedRecordItem {
  flagId: string
  title: string
  period: string
  value: string
  unit: string
  message: string
  /** False for a critical flag: it is corrected or re-documented, never noted away. */
  canKeep: boolean
  mustFix: boolean
  overdue: boolean
}

// Spelled out rather than left to Intl, whose short months differ between ICU
// versions ("Sep" or "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function month(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function periodLabel(start: Date, end: Date): string {
  const from = month(start)
  const to = month(end)
  return from === to ? from : `${from} – ${to}`
}

export function toFlaggedRecordItems(rows: readonly FlaggedRecordRow[], now: Date): FlaggedRecordItem[] {
  const ordered = [...rows].sort((a, b) => {
    const critical = Number(b.severity === 'CRITICAL') - Number(a.severity === 'CRITICAL')
    if (critical !== 0) return critical
    const due = (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)
    return Number.isNaN(due) ? 0 : due
  })
  return ordered.map(f => {
    const shown = shownMeasurement(f.dataRecord)
    return {
      flagId: f.id,
      title: fieldLabel(f.dataRecord.fieldName, f.dataRecord.domain),
      period: periodLabel(f.dataRecord.periodStart, f.dataRecord.periodEnd),
      value: shown.value.toLocaleString('en-GB', { maximumFractionDigits: 6 }),
      unit: shown.unit,
      message: f.message,
      canKeep: f.severity !== 'CRITICAL',
      mustFix: f.severity === 'CRITICAL',
      overdue: f.dueAt !== null && f.dueAt.getTime() < now.getTime(),
    }
  })
}
