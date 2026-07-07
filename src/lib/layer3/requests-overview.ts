import { DOMAIN_LABELS } from '@/lib/domain-labels'
// Layer 3 — Access. Read-only. Fuses the three request sources a supplier
// experiences as one idea into two human sections (plus a separate "sent" list
// for buyers). It classifies and formats; it makes no decisions and writes nothing.

export type DataRequestInput = {
  id: string
  status: string // RequestStatus
  direction: 'incoming' | 'outgoing'
  counterpartyName: string
  domain: string
  periodStart: string
  periodEnd: string
  deadline: string | null
  createdAt: string
}

export type InboundRequestInput = {
  id: string
  status: string // InboundRequestStatus
  fromEmail: string | null
  createdAt: string
  answeredAt: string | null
}

export type SharedExportInput = {
  id: string
  domain: string | null
  state: 'active' | 'revoked' | 'expired'
  createdAt: string
}

export type RequestItem = {
  id: string
  source: 'data-request' | 'email-request' | 'shared-link'
  title: string
  detail: string
  href: string
  timestamp: string
}

export type CategorisedRequests = {
  waiting: RequestItem[]
  shared: RequestItem[]
  sent: RequestItem[]
}

const INCOMING_WAITING = new Set(['PENDING', 'QUERY_RAISED'])

function period(start: string, end: string): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export function categoriseRequests(input: {
  dataRequests: DataRequestInput[]
  inboundRequests: InboundRequestInput[]
  sharedExports: SharedExportInput[]
}): CategorisedRequests {
  const waiting: RequestItem[] = []
  const shared: RequestItem[] = []
  const sent: RequestItem[] = []

  for (const d of input.dataRequests) {
    const domain = DOMAIN_LABELS[d.domain] ?? d.domain
    if (d.direction === 'outgoing') {
      sent.push({
        id: d.id, source: 'data-request', href: '/requests/data', timestamp: d.createdAt,
        title: `You asked ${d.counterpartyName}`,
        detail: `${domain} · ${period(d.periodStart, d.periodEnd)}`,
      })
    } else if (INCOMING_WAITING.has(d.status)) {
      waiting.push({
        id: d.id, source: 'data-request', href: '/requests/data', timestamp: d.createdAt,
        title: `Data request from ${d.counterpartyName}`,
        detail: d.deadline
          ? `${domain} · due ${new Date(d.deadline).toLocaleDateString('en-GB')}`
          : `${domain} · ${period(d.periodStart, d.periodEnd)}`,
      })
    } else {
      shared.push({
        id: d.id, source: 'data-request', href: '/requests/data', timestamp: d.createdAt,
        title: `Answered ${d.counterpartyName}`,
        detail: `${domain} · ${period(d.periodStart, d.periodEnd)}`,
      })
    }
  }

  for (const e of input.inboundRequests) {
    if (e.status === 'ANSWERED') {
      shared.push({
        id: e.id, source: 'email-request', href: '/inbound-requests', timestamp: e.answeredAt ?? e.createdAt,
        title: e.fromEmail ? `Email request from ${e.fromEmail}` : 'Email request',
        detail: 'Answered from your records',
      })
    } else {
      waiting.push({
        id: e.id, source: 'email-request', href: '/inbound-requests', timestamp: e.createdAt,
        title: e.fromEmail ? `Email request from ${e.fromEmail}` : 'Email request',
        detail: 'Needs data',
      })
    }
  }

  for (const s of input.sharedExports) {
    shared.push({
      id: s.id, source: 'shared-link', href: '/shares', timestamp: s.createdAt,
      title: `Shared link · ${s.domain ? (DOMAIN_LABELS[s.domain] ?? s.domain) : 'All domains'}`,
      detail: s.state === 'active' ? 'Active' : s.state === 'expired' ? 'Expired' : 'Revoked',
    })
  }

  const newestFirst = (a: RequestItem, b: RequestItem) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  waiting.sort(newestFirst)
  shared.sort(newestFirst)
  sent.sort(newestFirst)

  return { waiting, shared, sent }
}
