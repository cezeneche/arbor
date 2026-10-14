// Layer 3: classify existing work and match stored periods to explicit requests.
// Readiness here means available fields, never certification of a response or filing.
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { fieldLabel } from './field-label'

export interface DashboardRecord {
  id: string
  domain: string
  fieldName: string
  periodStart: Date
  periodEnd: Date
  trustTier: string
  staleAfterDate: Date | null
  critical: boolean
}
export interface DashboardRequest {
  id: string
  direction: 'incoming' | 'outgoing'
  counterparty: string
  domain: string
  periodStart: Date
  periodEnd: Date
  requiredFields: string[]
  deadline: Date | null
  status: string
  requestedById: string
  requestedByName: string
}
export interface DashboardDocument {
  id: string
  fileName: string
  domain: string
  status: string
  autoAccepted: boolean
  submittedById: string
  submittedByName: string
  submittedAt: Date
}
export interface DashboardFlag {
  id: string
  recordId: string
  domain: string
  fieldName: string
  message: string
  severity: string
  assigneeId: string | null
  assigneeName: string | null
  dueAt: Date | null
}
export interface DashboardInput {
  now: Date
  userId: string
  documents: DashboardDocument[]
  requests: DashboardRequest[]
  records: DashboardRecord[]
  flags: DashboardFlag[]
  stewards: { domain: string; userId: string; name: string }[]
  inbound: { id: string; fromEmail: string | null; ready: boolean; status: string }[]
  handoffs: {
    id: string
    documentId: string
    fileName: string
    submittedById: string
    submittedByName: string
    status: string
    caseId: string | null
  }[]
}
export interface DashboardTask {
  id: string
  kind: 'review' | 'request' | 'quality' | 'upload' | 'email' | 'cbam'
  title: string
  detail: string
  href: string
  action: string
  owner: string
  ownerId: string | null
  deadline: string | null
  tone: 'neutral' | 'warning' | 'danger' | 'good'
  label: string
  flagId?: string
}
export interface DashboardCommitment {
  id: string
  title: string
  scope: string
  direction: 'incoming' | 'outgoing'
  deadline: string | null
  status: string
  detail: string
  owner: string
  href: string
  ready: boolean
  covered: number
  requested: number
}
export interface RequestCoverage {
  requested: number
  covered: number
  missing: string[]
  ready: boolean
  issues: boolean
}

const DAY = 86_400_000
const day = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
const domainLabel = (domain: string) => DOMAIN_LABELS[domain] ?? domain
export const requestHref = (id: string) => `/requests/data?request=${encodeURIComponent(id)}`
export const recordHref = (id: string) => `/records?record=${encodeURIComponent(id)}`

// A single overlapping month cannot stand in for a whole quarter. Dates describe
// inclusive calendar periods; adjacent monthly records may jointly cover them.
function coversPeriod(records: DashboardRecord[], start: Date, end: Date): boolean {
  let cursor = day(start)
  const last = day(end)
  if (!Number.isFinite(cursor) || !Number.isFinite(last) || cursor > last) return false
  const ranges = records
    .map(r => [day(r.periodStart), day(r.periodEnd)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a <= b)
    .sort((a, b) => a[0] - b[0])
  for (const [a, b] of ranges) {
    if (b < cursor) continue
    if (a > cursor) return false
    cursor = Math.max(cursor, b + DAY)
    if (cursor > last) return true
  }
  return false
}

export function requestCoverage(
  request: DashboardRequest,
  records: DashboardRecord[],
  now: Date,
): RequestCoverage {
  const fields = [...new Set(request.requiredFields.filter(Boolean))]
  const relevant = records.filter(
    r =>
      r.domain === request.domain &&
      fields.includes(r.fieldName) &&
      r.periodStart <= request.periodEnd &&
      r.periodEnd >= request.periodStart,
  )
  const usable = relevant.filter(r => !r.critical && (!r.staleAfterDate || r.staleAfterDate > now))
  const missing = fields.filter(
    field =>
      !coversPeriod(
        usable.filter(r => r.fieldName === field),
        request.periodStart,
        request.periodEnd,
      ),
  )
  const issues = relevant.some(r => r.critical)
  return {
    requested: fields.length,
    covered: fields.length - missing.length,
    missing,
    issues,
    ready: fields.length > 0 && missing.length === 0 && !issues,
  }
}

export function dashboardDate(value: string | Date | null): string {
  return value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'No deadline set'
}

export function deadlineLabel(value: string | null, now: Date): string {
  if (!value) return 'No deadline set'
  const days = Math.round((day(new Date(value)) - day(now)) / DAY)
  if (days < 0) return `Overdue · ${dashboardDate(value)}`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due ${dashboardDate(value)}`
}

export function buildDashboard(input: DashboardInput) {
  const tasks: DashboardTask[] = []
  const interventions: DashboardTask[] = []
  const waiting: DashboardTask[] = []
  const commitments: DashboardCommitment[] = []
  const stewards = new Map(input.stewards.map(s => [s.domain, s]))
  const own = (id: string | null) => !id || id === input.userId
  const iso = (date: Date | null) => date?.toISOString() ?? null
  const openIncoming = input.requests.filter(
    r => r.direction === 'incoming' && ['PENDING', 'QUERY_RAISED'].includes(r.status),
  )

  for (const request of input.requests) {
    const outgoing = request.direction === 'outgoing'
    const coverage = outgoing
      ? { ready: false, covered: 0, requested: 0, missing: [], issues: false }
      : requestCoverage(request, input.records, input.now)
    const steward = stewards.get(request.domain)
    const ownerId = outgoing ? request.requestedById : (steward?.userId ?? null)
    const owner = outgoing ? request.requestedByName : (steward?.name ?? 'No data steward')
    const submitted = request.status === 'SUBMITTED'
    const queried = request.status === 'QUERY_RAISED'
    const status = outgoing
      ? submitted
        ? 'Response received'
        : 'Waiting on supplier'
      : submitted
        ? 'Awaiting buyer'
        : queried
          ? 'Buyer raised a query'
          : coverage.ready
            ? 'Fields available'
            : coverage.issues
              ? 'Quality issue'
              : 'Data needed'
    const detail = outgoing
      ? submitted
        ? 'Review the supplier’s response and shared scope.'
        : 'The supplier has not submitted a response.'
      : submitted
        ? 'Your response was submitted. The buyer has not accepted it yet.'
        : queried
          ? 'Review the buyer’s question before responding again.'
          : coverage.requested === 0
            ? 'Review the requested scope; no explicit field list was provided.'
            : coverage.ready
              ? `${coverage.covered}/${coverage.requested} fields cover the requested period. Review sources and labels before sharing.`
              : coverage.issues
                ? 'Resolve critical issues in the requested data before preparing the response.'
                : `${coverage.covered}/${coverage.requested} fields cover the full period. Check ${coverage.missing
                    .slice(0, 2)
                    .map(f => fieldLabel(f, request.domain))
                    .join(', ')}${coverage.missing.length > 2 ? ' and other fields' : ''}.`
    commitments.push({
      id: request.id,
      title: request.counterparty,
      scope: `${domainLabel(request.domain)} · ${dashboardDate(request.periodStart)} – ${dashboardDate(request.periodEnd)}`,
      direction: request.direction,
      deadline: iso(request.deadline),
      status,
      detail,
      owner,
      href: requestHref(request.id),
      ready: !outgoing && !submitted && !queried && coverage.ready,
      covered: coverage.covered,
      requested: coverage.requested,
    })
    const task: DashboardTask = {
      id: `request-${request.id}`,
      kind: 'request',
      title: outgoing
        ? `${submitted ? 'Review the response from' : 'Waiting for'} ${request.counterparty}`
        : `${submitted ? 'Response sent to' : 'Respond to'} ${request.counterparty}`,
      detail: `${domainLabel(request.domain)} · ${detail}`,
      href: requestHref(request.id),
      action: outgoing ? 'View request' : 'Review request',
      owner: ownerId ? owner : 'Shared team queue',
      ownerId,
      deadline: iso(request.deadline),
      tone: coverage.ready ? 'good' : 'warning',
      label: status,
    }
    if ((outgoing && !submitted) || (!outgoing && submitted)) waiting.push(task)
    else if (own(ownerId)) tasks.push(task)
  }

  for (const doc of input.documents) {
    const review = doc.status === 'REVIEW_REQUIRED' || doc.autoAccepted
    const rejected = doc.status === 'REJECTED'
    if (!review && !rejected) continue
    const steward = stewards.get(doc.domain)
    const linked = openIncoming
      .filter(r => r.domain === doc.domain)
      .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity))[0]
    const ownerId = steward?.userId ?? doc.submittedById
    const task: DashboardTask = {
      id: `doc-${doc.id}`,
      kind: rejected ? 'upload' : 'review',
      title: `${rejected ? 'Check the failed upload' : 'Review'}: ${doc.fileName}`,
      detail: rejected
        ? 'This document could not be accepted. Inspect it and upload a replacement if needed.'
        : `${doc.autoAccepted ? 'Stored as Declared; human review is still needed.' : 'Confirm the extracted values before they are stored.'}${linked ? ` ${linked.counterparty} has an open ${domainLabel(doc.domain).toLowerCase()} request; check whether this document supplies the missing period and fields.` : ''}`,
      href: `/upload/${encodeURIComponent(doc.id)}/review`,
      action: rejected ? 'Inspect document' : 'Review values',
      owner: steward?.name ?? doc.submittedByName,
      ownerId,
      deadline: iso(linked?.deadline ?? null),
      tone: rejected ? 'danger' : 'warning',
      label: rejected
        ? 'Upload needs attention'
        : doc.autoAccepted
          ? 'Stored · review needed'
          : 'Awaiting confirmation',
    }
    if (own(ownerId)) tasks.push(task)
    if (rejected) interventions.push(task)
  }

  for (const flag of input.flags) {
    const task: DashboardTask = {
      id: `flag-${flag.id}`,
      flagId: flag.id,
      kind: 'quality',
      title: `Check ${fieldLabel(flag.fieldName, flag.domain).toLowerCase()}`,
      detail: flag.message,
      href: recordHref(flag.recordId),
      action: 'Inspect record',
      owner: flag.assigneeName ?? 'Shared team queue',
      ownerId: flag.assigneeId,
      deadline: iso(flag.dueAt),
      tone: flag.severity === 'CRITICAL' ? 'danger' : 'warning',
      label: !flag.assigneeId
        ? 'Owner needed'
        : flag.severity === 'CRITICAL'
          ? 'Critical quality issue'
          : 'Quality check',
    }
    if (own(flag.assigneeId)) tasks.push(task)
    if (!flag.assigneeId || flag.severity === 'CRITICAL' || (flag.dueAt && flag.dueAt < input.now))
      interventions.push(task)
  }

  for (const req of input.inbound) {
    // Email requests have no assignee in storage; label them as shared work.
    tasks.push({
      id: `email-${req.id}`,
      kind: 'email',
      title: `Email request${req.fromEmail ? ` from ${req.fromEmail}` : ''}`,
      detail: req.ready
        ? 'A draft answer is available. Check the records and recipient before sending.'
        : req.status === 'NEW'
          ? 'This request is still being read. Check its progress.'
          : 'Review the request and the missing information.',
      href: `/inbound-requests#request-${encodeURIComponent(req.id)}`,
      action: 'Review email request',
      owner: 'Shared team queue',
      ownerId: null,
      deadline: null,
      tone: req.ready ? 'good' : 'neutral',
      label: req.ready ? 'Draft available' : 'Request to review',
    })
  }
  for (const link of input.handoffs) {
    if (link.status === 'CREATED') continue
    const task: DashboardTask = {
      id: `cbam-${link.id}`,
      kind: 'cbam',
      title: `Continue CBAM setup: ${link.fileName}`,
      detail:
        'The document is saved, but its handoff to the case is unfinished. Open CBAM to resolve the missing information or retry.',
      href: '/cbam?view=cases',
      action: 'Continue case setup',
      owner: link.submittedByName,
      ownerId: link.submittedById,
      deadline: null,
      tone: link.status === 'FAILED' ? 'danger' : 'warning',
      label: 'Case setup unfinished',
    }
    if (own(task.ownerId)) tasks.push(task)
    interventions.push(task)
  }
  const sortTasks = (a: DashboardTask, b: DashboardTask) => {
    const urgency = (task: DashboardTask) =>
      task.deadline && day(new Date(task.deadline)) <= day(input.now) + DAY
        ? 0
        : task.tone === 'danger'
          ? 1
          : task.deadline
            ? 2
            : 3
    return (
      urgency(a) - urgency(b) ||
      (a.deadline && b.deadline ? Date.parse(a.deadline) - Date.parse(b.deadline) : 0) ||
      Number(b.kind === 'review') - Number(a.kind === 'review') ||
      a.id.localeCompare(b.id)
    )
  }
  tasks.sort(sortTasks)
  interventions.sort((a, b) => Number(Boolean(a.ownerId)) - Number(Boolean(b.ownerId)) || sortTasks(a, b))
  waiting.sort(sortTasks)
  commitments.sort(
    (a, b) =>
      (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity) ||
      a.id.localeCompare(b.id),
  )
  return { tasks, interventions, waiting, commitments }
}
