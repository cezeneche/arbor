// Layer 3 — Access. Pure, read-only. §4: the severity model.
//
// One function, so the conditions live in one place rather than scattered
// through JSX where they cannot be tested or counted.
//
//   blocking  — prevents a declaration or costs money
//   attention — needs doing, nothing at stake this period
//   clear     — neither, and said out loud
//
// `clear` gets a line of its own because absence is ambiguous: a manager
// looking at nothing cannot tell whether it means all clear or never checked.
//
// Ordering note: the spec sorts blocking items by financial cost first. Nothing
// in the schema carries a cost and there is no basis to derive one, so items
// are ordered by deadline instead — soonest first, undated last. Inventing a
// cost would break the rule that every number traces to a record.

import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { currentDeclarationPeriod, lastPeriods } from './declaration-period'
import type { UnitConflict } from './unit-integrity'

/** A period closing sooner than this with no record is blocking. */
const BLOCKING_WINDOW_DAYS = 45
/** A value this far from the trailing mean is worth a look. */
const OUTLIER_DEVIATION = 0.5
/** How many periods the mean is taken over. */
const TRAILING_PERIODS = 4

export type Severity = 'blocking' | 'attention'

export interface AttentionItem {
  key: string
  severity: Severity
  /** One sentence naming the object and stating the consequence. */
  sentence: string
  actionLabel: string
  href: string
  /** Drives ordering; null sorts last. */
  deadline: Date | null
}

export interface AttentionRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
  periodStart: Date | string
  periodEnd: Date | string
}

export interface AttentionRequest {
  id: string
  counterpartyName: string
  domain: string
  deadline: Date | string | null
}

export interface AttentionDocument {
  id: string
  fileName: string
  status: string
  errorMessage?: string | null
  /** Extracted values waiting to be checked. */
  valueCount?: number
}

export interface Disagreement {
  fieldName: string
  discrepancyPercent: number
}

export interface AttentionInput {
  now: Date
  records: AttentionRecord[]
  requests: AttentionRequest[]
  documents: AttentionDocument[]
  unitConflicts: UnitConflict[]
  disagreements: Disagreement[]
}

export interface AttentionResult {
  state: 'blocking' | 'attention' | 'clear'
  blocking: AttentionItem[]
  attention: AttentionItem[]
  /** Set only in the clear state. */
  clearLine: string | null
}

const label = (domain: string) => DOMAIN_LABELS[domain] ?? domain

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && aEnd >= bStart
}

export function buildAttention(input: AttentionInput): AttentionResult {
  const { now, records, requests, documents, unitConflicts, disagreements } = input

  const blocking: AttentionItem[] = []
  const attention: AttentionItem[] = []

  const period = currentDeclarationPeriod(now)
  const keptDomains = [...new Set(records.map(r => r.domain))]

  // ── blocking ──────────────────────────────────────────────────────────────

  // A record type with nothing for a period about to close. Named for what it
  // costs: the period reports as Estimated rather than Verified.
  if (period.daysToClose <= BLOCKING_WINDOW_DAYS) {
    for (const domain of keptDomains) {
      const covered = records.some(r =>
        r.domain === domain &&
        overlaps(new Date(r.periodStart), new Date(r.periodEnd), period.start, period.end),
      )
      if (covered) continue
      blocking.push({
        key: `gap-${domain}-${period.label}`,
        severity: 'blocking',
        sentence: `${period.label} ${label(domain).toLowerCase()} has no record. This period will be reported as Estimated rather than Verified.`,
        actionLabel: 'Add record',
        href: `/upload?domain=${domain}`,
        deadline: period.closesOn,
      })
    }
  }

  for (const doc of documents) {
    if (doc.status !== 'REJECTED' && doc.status !== 'FAILED') continue
    const reason = doc.errorMessage?.trim()
    blocking.push({
      key: `failed-${doc.id}`,
      severity: 'blocking',
      sentence: reason
        ? `${doc.fileName} could not be read. ${reason.replace(/\.$/, '')}.`
        : `${doc.fileName} could not be read, so nothing from it was saved.`,
      actionLabel: 'Upload again',
      href: '/upload',
      deadline: null,
    })
  }

  for (const d of disagreements) {
    blocking.push({
      key: `disagree-${d.fieldName}`,
      severity: 'blocking',
      sentence: `Two documents disagree on ${d.fieldName.replace(/_/g, ' ')} by ${Math.round(d.discrepancyPercent)}%. Neither figure can be shared until you say which is right.`,
      actionLabel: 'Resolve',
      href: '/records',
      deadline: null,
    })
  }

  // One item per record type, not per record. Ten bills written in the wrong
  // unit are one mistake to fix, and ten identical sentences is a wall the
  // reader stops reading.
  const conflictsByField = new Map<string, UnitConflict[]>()
  for (const c of unitConflicts) {
    const key = `${c.domain}::${c.fieldName}::${c.unit}`
    conflictsByField.set(key, [...(conflictsByField.get(key) ?? []), c])
  }
  for (const [key, group] of conflictsByField) {
    const [c] = group
    const count = group.length
    blocking.push({
      key: `unit-${key}`,
      severity: 'blocking',
      sentence: `${count} ${c.fieldName.replace(/_/g, ' ')} record${count === 1 ? ' is' : 's are'} stored in ${c.unit}, but this record type is recorded in ${c.expected}. ${count === 1 ? 'It cannot' : 'They cannot'} be counted until corrected.`,
      actionLabel: count === 1 ? 'Open record' : 'Open records',
      href: `/records?domain=${c.domain}`,
      deadline: null,
    })
  }

  // ── attention ─────────────────────────────────────────────────────────────

  for (const req of requests) {
    if (!req.deadline) continue
    const due = new Date(req.deadline)
    if (Number.isNaN(due.getTime()) || due >= now) continue
    attention.push({
      key: `overdue-${req.id}`,
      severity: 'attention',
      sentence: `Your ${label(req.domain).toLowerCase()} request to ${req.counterpartyName} was due ${fmtDate(due)} and has had no answer.`,
      actionLabel: 'Chase it',
      href: '/requests',
      deadline: due,
    })
  }

  const awaiting = documents.filter(d => d.status === 'REVIEW_REQUIRED')
  const awaitingValues = awaiting.reduce((n, d) => n + (d.valueCount ?? 0), 0)
  if (awaiting.length > 0) {
    attention.push({
      key: 'awaiting-review',
      severity: 'attention',
      sentence: `${awaitingValues} value${awaitingValues === 1 ? '' : 's'} from ${awaiting.length} document${awaiting.length === 1 ? '' : 's'} are waiting to be checked. They are not saved until you do.`,
      actionLabel: 'Check them',
      href: '/review',
      deadline: null,
    })
  }

  // A value well away from where this type has been sitting. Not wrong, but
  // worth a second look before it goes to a customer.
  const windows = lastPeriods(now, TRAILING_PERIODS + 1)
  const currentWindow = windows[windows.length - 1]
  const trailing = windows.slice(0, TRAILING_PERIODS)

  const seriesKey = (r: AttentionRecord) => `${r.domain}::${r.fieldName}`
  const series = new Set(records.map(seriesKey))

  for (const key of series) {
    const own = records.filter(r => seriesKey(r) === key)
    const history = own.filter(r =>
      trailing.some(p => overlaps(new Date(r.periodStart), new Date(r.periodEnd), p.start, p.end)),
    )
    const latest = own.find(r =>
      overlaps(new Date(r.periodStart), new Date(r.periodEnd), currentWindow.start, currentWindow.end),
    )
    if (!latest || history.length < TRAILING_PERIODS) continue

    const mean = history.reduce((sum, r) => sum + r.value, 0) / history.length
    if (mean === 0) continue
    if (Math.abs(latest.value - mean) / Math.abs(mean) <= OUTLIER_DEVIATION) continue

    const [domain, fieldName] = key.split('::')
    const direction = latest.value > mean ? 'above' : 'below'
    attention.push({
      key: `outlier-${latest.id}`,
      severity: 'attention',
      sentence: `${label(domain)} ${fieldName.replace(/_/g, ' ')} for ${currentWindow.label} is well ${direction} the last four periods. Worth checking before it is shared.`,
      actionLabel: 'Open record',
      href: '/records',
      deadline: null,
    })
  }

  // ── order and state ───────────────────────────────────────────────────────

  const byDeadline = (a: AttentionItem, b: AttentionItem) => {
    if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime()
    if (a.deadline) return -1
    if (b.deadline) return 1
    return 0
  }
  blocking.sort(byDeadline)
  attention.sort(byDeadline)

  if (blocking.length > 0) return { state: 'blocking', blocking, attention, clearLine: null }
  if (attention.length > 0) return { state: 'attention', blocking, attention, clearLine: null }

  return {
    state: 'clear',
    blocking: [],
    attention: [],
    clearLine: buildClearLine(keptDomains, period),
  }
}

function buildClearLine(
  keptDomains: string[],
  period: ReturnType<typeof currentDeclarationPeriod>,
): string {
  if (keptDomains.length === 0) {
    return 'Nothing needs you yet. Upload a document to start your record.'
  }
  const next = label(keptDomains[0])
  return `Nothing needs you. Next due is ${next} for ${period.label}, from ${fmtDate(period.closesOn)}.`
}
