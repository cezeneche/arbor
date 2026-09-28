// A kept audit narrative, as the case page shows it. Pure.

export interface StoredNarrative {
  generatedAt: Date
  reviewRequired: boolean
  reviewReasons: unknown
  narrative: unknown
  emailedAt: Date | null
  packHash: string | null
}

export interface PresentedNarrative {
  byline: string
  reviewRequired: boolean
  reasons: string[]
  /** Whether the organisation was told, when review is needed. */
  emailed: string | null
  summary: string | null
  methodology: string | null
  limitations: string[]
  openGaps: { field: string; issue: string }[]
  packHash: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function strings(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list.map(text).filter((s): s is string => s !== null)
}

export function presentNarrative(row: StoredNarrative, generatedBy: string | null): PresentedNarrative {
  const n = (row.narrative && typeof row.narrative === 'object' ? row.narrative : {}) as Record<string, unknown>
  const zone = { timeZone: 'Europe/London' } as const
  const when =
    row.generatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...zone }) +
    ', ' +
    row.generatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...zone })
  return {
    byline: `Written ${when}${generatedBy ? ` at the request of ${generatedBy}` : ''}`,
    reviewRequired: row.reviewRequired,
    reasons: strings(row.reviewReasons),
    emailed: !row.reviewRequired
      ? null
      : row.emailedAt
        ? 'The organisation was emailed about the review.'
        : 'No one in the organisation was emailed about the review.',
    summary: text(n.executive_summary),
    methodology: text(n.methodology),
    limitations: strings(n.limitations),
    openGaps: (Array.isArray(n.open_gaps) ? n.open_gaps : [])
      .map(g => (g && typeof g === 'object' ? (g as Record<string, unknown>) : {}))
      .map(g => ({ field: text(g.field) ?? '—', issue: text(g.issue) ?? '' }))
      .filter(g => g.issue),
    packHash: row.packHash,
  }
}
