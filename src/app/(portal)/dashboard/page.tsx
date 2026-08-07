import Link from 'next/link'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { getSessionUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'
import { NUMERIC_FIELDS, derivePeriod } from '@/lib/review/review-policy'
import { summariseOperationalPosition } from '@/lib/layer3/overview-summary'
import { buildOverviewPriorities } from '@/lib/layer3/overview-priorities'
import { buildPeriodCoverage, type CellState } from '@/lib/layer3/period-coverage'

// The Overview answers an ops manager's questions in the order they have them:
//
//   1. Is anything blocking me right now?      → Needs you now
//   2. What breaks next?                        → Watch list
//   3. Am I up to date?                         → the coverage grid
//   4. What do my records actually say?         → headline figures
//   5. What moved since I was last here?        → recent activity
//
// Nothing on this page is a statistic the user cannot act on.

const DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

// How many headline figures fit before the screen stops being a glance.
const HEADLINE_LIMIT = 6

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Record saved',
  CREATED_VIA_SUBMISSION_LINK: 'Record saved from a shared link',
  SUPERSEDED: 'Record replaced',
  CORRECTED: 'Record corrected',
  TIER_UPGRADED: 'Record upgraded to Verified',
  CHAIN_VERIFIED: 'Audit trail checked',
}

const colStyle = {
  padding: '10px 14px',
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
}

const cellStyle = {
  padding: '10px 14px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  fontVariantNumeric: 'tabular-nums' as const,
}

const sectionLabel = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
}

// How each coverage cell reads. "Missing" is the only alarming one, and it is
// only ever shown for a period after this business started keeping that record.
const CELL_STYLE: Record<CellState, { label: string; fg: string; bg: string }> = {
  recorded: { label: 'Recorded', fg: colours.green, bg: colours.greenBg },
  awaiting_check: { label: 'To check', fg: colours.amber, bg: colours.amberBg },
  missing: { label: 'Missing', fg: colours.red, bg: colours.redBg },
  before_first: { label: '—', fg: colours.textTertiary, bg: 'transparent' },
}

function relativeDay(date: Date, now: Date): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string
  const now = new Date()

  const [
    entity, allRecords, reviewDocs, criticalFlags, failedDocuments,
    expiringDocs, staleRecords, recentEntries,
  ] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { entityType: true } }),
    // One read serves the headline figures, the coverage grid and the matrix.
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true },
      select: {
        domain: true, fieldName: true, trustTier: true,
        value: true, unit: true, periodStart: true, periodEnd: true,
      },
    }),
    // Documents that arrived but were never confirmed — they hold no records yet.
    prisma.document.findMany({
      where: { entityId, status: 'REVIEW_REQUIRED' },
      select: {
        id: true,
        documentType: true,
        extractionJobs: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          select: { extractedFields: { select: { fieldName: true, rawValue: true } } },
        },
      },
      take: 50,
    }),
    prisma.validationFlag.count({
      where: { resolvedAt: null, severity: 'CRITICAL', dataRecord: { entityId, isActive: true } },
    }),
    prisma.document.count({ where: { entityId, status: 'REJECTED' } }),
    // documents with a flagged expiry_date field (certificate expiry).
    prisma.document.findMany({
      where: {
        entityId,
        status: 'ACCEPTED',
        extractionJobs: { some: { extractedFields: { some: { fieldName: 'expiry_date', flagged: true } } } },
      },
      include: {
        extractionJobs: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          include: { extractedFields: { where: { fieldName: 'expiry_date', flagged: true } } },
        },
      },
      take: 20,
    }),
    // batch/mill records past their staleness horizon.
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true, staleAfterDate: { not: null, lt: now } },
      include: { document: { select: { documentType: true, fileName: true, id: true } } },
      orderBy: { staleAfterDate: 'asc' },
      take: 20,
    }),
    prisma.auditEntry.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, eventType: true, createdAt: true },
      take: 5,
    }),
  ])

  // Suppliers see plain English certification; buyers keep the technical form.
  const isSupplier = entity?.entityType !== 'BUYER'

  // ── 1. Needs you now ────────────────────────────────────────────────────────
  // Only the numeric fields count: those are the ones the user is asked to check.
  let valuesAwaitingCheck = 0
  const pendingPeriods: { domain: string; periodStart: Date; periodEnd: Date }[] = []
  for (const doc of reviewDocs) {
    const fields = doc.extractionJobs[0]?.extractedFields ?? []
    const numeric = fields.filter(f => NUMERIC_FIELDS.has(f.fieldName) && f.rawValue)
    if (numeric.length === 0) continue
    valuesAwaitingCheck += numeric.length

    const values: Record<string, string | null> = {}
    for (const f of fields) values[f.fieldName] = f.rawValue
    const { periodStart, periodEnd } = derivePeriod(values, { documentType: doc.documentType })
    pendingPeriods.push({
      domain: DOMAIN_BY_DOCUMENT_TYPE[doc.documentType] ?? 'COMPLIANCE',
      periodStart,
      periodEnd,
    })
  }

  const priorities = buildOverviewPriorities({
    valuesAwaitingCheck,
    documentsAwaitingCheck: pendingPeriods.length,
    criticalFlags,
    failedDocuments,
  })

  // ── 2. Watch list — certificate expiry and staleness ────────────────────────
  const readableDocType = (t: string) =>
    t.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  type AttentionItem = { key: string; text: string; docType: string }
  const attentionItems: AttentionItem[] = []
  for (const doc of expiringDocs) {
    const field = doc.extractionJobs[0]?.extractedFields[0]
    if (!field) continue
    const expiry = field.rawValue ? new Date(field.rawValue) : null
    const label = readableDocType(doc.documentType)
    if (expiry && !isNaN(expiry.getTime())) {
      const expired = expiry < now
      const dateStr = expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      attentionItems.push({
        key: `cert-${doc.id}`,
        docType: doc.documentType,
        text: expired
          ? `Your ${label} expired ${dateStr} - upload a renewal to restore Verified status.`
          : `Your ${label} expires ${dateStr} - upload a renewal to keep this record Verified.`,
      })
    }
  }
  for (const rec of staleRecords) {
    const label = rec.document ? readableDocType(rec.document.documentType) : 'record'
    attentionItems.push({
      key: `stale-${rec.id}`,
      docType: rec.document?.documentType ?? '',
      text: `Your ${label} for the period ending ${new Date(rec.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} is now stale - upload a current document to refresh it.`,
    })
  }

  // ── 3. Am I up to date? ─────────────────────────────────────────────────────
  const coverage = buildPeriodCoverage({
    records: allRecords.map(r => ({ domain: r.domain, periodStart: r.periodStart, periodEnd: r.periodEnd })),
    pending: pendingPeriods,
    now,
  })
  const quarters = coverage[0]?.cells.map(c => c.quarter) ?? []
  const gapCount = coverage.reduce(
    (n, row) => n + row.cells.filter(c => c.state === 'missing').length,
    0,
  )

  // ── 4. What your records say ────────────────────────────────────────────────
  const position = summariseOperationalPosition(
    allRecords.map(r => ({
      domain: r.domain,
      fieldName: r.fieldName,
      value: r.value,
      unit: r.unit,
      trustTier: r.trustTier as 'A' | 'B' | 'C',
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    })),
  )
  const headlines = position.headlines.slice(0, HEADLINE_LIMIT)

  type DomainRow = { domain: string; A: number; B: number; C: number; total: number }
  const matrix: DomainRow[] = DOMAINS.map(domain => {
    const rows = allRecords.filter(r => r.domain === domain)
    const A = rows.filter(r => r.trustTier === 'A').length
    const B = rows.filter(r => r.trustTier === 'B').length
    const C = rows.filter(r => r.trustTier === 'C').length
    return { domain, A, B, C, total: A + B + C }
  }).filter(r => r.total > 0)

  const totalRecords = allRecords.length
  const verifiedCount = allRecords.filter(r => r.trustTier === 'A').length
  const declaredCount = allRecords.filter(r => r.trustTier === 'B').length
  const estimatedCount = allRecords.filter(r => r.trustTier === 'C').length
  const verifiedPct = totalRecords > 0 ? Math.round((verifiedCount / totalRecords) * 100) : 0
  const verifiedColour =
    verifiedPct >= 75 ? colours.green : verifiedPct >= 40 ? colours.amber : colours.red

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing[4],
        }}
      >
        <h1 style={textStyles.pageTitle}>Overview</h1>
        <Link
          href="/upload"
          style={{
            padding: '10px 20px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            borderRadius: '4px',
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
          }}
        >
          Upload documents
        </Link>
      </div>

      {/* 1. Needs you now — the only band that can stop the day. */}
      {priorities.length > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <span style={{ ...sectionLabel, color: colours.red, display: 'block', marginBottom: spacing[1] }}>
            Needs you now
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {priorities.map(item => {
              const critical = item.severity === 'critical'
              return (
                <div
                  key={item.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: spacing[2],
                    padding: `12px 14px`,
                    backgroundColor: critical ? colours.redBg : colours.amberBg,
                    border: `1px solid ${critical ? colours.red : colours.amber}`,
                    borderLeft: `3px solid ${critical ? colours.red : colours.amber}`,
                    borderRadius: '4px',
                  }}
                >
                  <span
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textPrimary,
                      lineHeight: typography.lineHeight.body,
                    }}
                  >
                    {item.text}
                  </span>
                  <Link
                    href={item.href}
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.navy,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {item.actionLabel} →
                  </Link>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 2. Watch list — what breaks next, with enough notice to act. */}
      {attentionItems.length > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <span style={{ ...sectionLabel, color: colours.amber, display: 'block', marginBottom: spacing[1] }}>
            Coming up
          </span>
          <div
            style={{
              backgroundColor: colours.amberBg,
              border: `1px solid ${colours.amber}`,
              borderLeft: `3px solid ${colours.amber}`,
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            {attentionItems.map((item, i) => (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: spacing[2],
                  padding: `12px 14px`,
                  borderBottom: i < attentionItems.length - 1 ? `1px solid ${colours.amber}22` : 'none',
                }}
              >
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textPrimary,
                  }}
                >
                  {item.text}
                </span>
                <Link
                  href={`/upload${item.docType ? `?type=${item.docType}` : ''}`}
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.navy,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap' as const,
                  }}
                >
                  Upload renewal →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Am I up to date? — the record types this business keeps, by quarter.
             The one view that answers "what am I missing" before a customer asks. */}
      {coverage.length > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing[2], marginBottom: spacing[1], flexWrap: 'wrap' as const }}>
            <div>
              <h2
                style={{
                  fontSize: typography.sizes.lg,
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                  letterSpacing: typography.tracking.tight,
                  margin: 0,
                }}
              >
                Are you up to date?
              </h2>
              <p style={{ ...textStyles.sectionSubtitle, marginTop: '4px' }}>
                {gapCount === 0
                  ? 'Every period you have been keeping records for is covered.'
                  : `${gapCount} period${gapCount === 1 ? '' : 's'} with nothing recorded. Upload the document for ${gapCount === 1 ? 'it' : 'those'} and the gap closes.`}
              </p>
            </div>
            <Link
              href="/upload"
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
                whiteSpace: 'nowrap' as const,
              }}
            >
              Fill a gap
            </Link>
          </div>

          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              overflow: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                  <th style={colStyle}>Record type</th>
                  {quarters.map(q => (
                    <th key={q.label} style={{ ...colStyle, textAlign: 'center' as const }}>{q.label}</th>
                  ))}
                  <th style={{ ...colStyle, textAlign: 'right' as const }}>Last recorded</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((row, i) => (
                  <tr
                    key={row.domain}
                    style={{ borderBottom: i < coverage.length - 1 ? `1px solid ${colours.border}` : 'none' }}
                  >
                    <td style={{ ...cellStyle, fontWeight: typography.weights.medium, whiteSpace: 'nowrap' as const }}>
                      {row.domainLabel}
                    </td>
                    {row.cells.map(cell => {
                      const style = CELL_STYLE[cell.state]
                      return (
                        <td key={cell.quarter.label} style={{ ...cellStyle, textAlign: 'center' as const }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: '4px',
                              backgroundColor: style.bg,
                              color: style.fg,
                              fontSize: typography.sizes.xs,
                              fontWeight: cell.state === 'before_first'
                                ? typography.weights.light
                                : typography.weights.medium,
                              whiteSpace: 'nowrap' as const,
                            }}
                            title={
                              cell.state === 'recorded'
                                ? `${cell.count} record${cell.count === 1 ? '' : 's'}`
                                : cell.state === 'before_first'
                                  ? 'You were not keeping this yet'
                                  : undefined
                            }
                          >
                            {style.label}
                          </span>
                        </td>
                      )
                    })}
                    <td style={{ ...cellStyle, textAlign: 'right' as const, color: colours.textSecondary, whiteSpace: 'nowrap' as const }}>
                      {row.lastCovered ?? 'Nothing saved yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. What your records say — the figures a customer asks for, as recorded.
             Each is the sum of your own stored records for that field in the same
             unit; nothing here is converted, weighted, or calculated. */}
      {headlines.length > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: spacing[1],
              gap: spacing[2],
              flexWrap: 'wrap' as const,
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: typography.sizes.lg,
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                  letterSpacing: typography.tracking.tight,
                  margin: 0,
                }}
              >
                What your records say for {position.reportingYear}
              </h2>
              {/* The one number worth a headline: how much of what you would send
                  a customer is backed by a document rather than your word. */}
              <p style={{ ...textStyles.sectionSubtitle, marginTop: '4px' }}>
                <span style={{ fontWeight: typography.weights.medium, color: verifiedColour }}>
                  {verifiedPct}% verified
                </span>
                {' — '}
                {verifiedCount.toLocaleString()} of {totalRecords.toLocaleString()} record
                {totalRecords === 1 ? '' : 's'} backed by a document
                {declaredCount > 0 && `, ${declaredCount.toLocaleString()} still on your word alone`}
              </p>
            </div>
            <Link
              href="/records"
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
                whiteSpace: 'nowrap' as const,
              }}
            >
              All records
            </Link>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '12px',
            }}
          >
            {headlines.map(h => (
              <div
                key={`${h.domain}-${h.fieldName}-${h.unit}`}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '4px',
                  padding: spacing[2],
                }}
              >
                <div
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.textTertiary,
                    letterSpacing: typography.tracking.wider,
                    textTransform: 'uppercase' as const,
                    marginBottom: '6px',
                  }}
                >
                  {h.domainLabel}
                </div>
                <div
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    marginBottom: '6px',
                  }}
                >
                  {h.label}
                </div>
                <div
                  style={{
                    fontSize: '24px',
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    letterSpacing: typography.tracking.tight,
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {h.total.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                  <span
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      marginLeft: '5px',
                    }}
                  >
                    {h.unit}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' as const }}>
                  {h.tierComposition.meet && (
                    <TierBadge tier={h.tierComposition.meet} plain={isSupplier} />
                  )}
                  <span
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textTertiary,
                    }}
                  >
                    from {h.recordCount} record{h.recordCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p
            style={{
              ...textStyles.caption,
              color: colours.textTertiary,
              marginTop: spacing[2],
              lineHeight: typography.lineHeight.body,
            }}
          >
            These are your own figures added up exactly as your documents recorded them, in the
            units they were recorded in. Arbor does not convert between units or work anything out
            from them — the status shown against each figure is the weakest of the records behind it.
          </p>
        </section>
      )}

      {totalRecords === 0 && priorities.length === 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              padding: spacing[4],
              textAlign: 'center',
            }}
          >
            <p style={{ ...textStyles.rowTitle, margin: `0 0 ${spacing[1]}` }}>
              Nothing saved yet.
            </p>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: `0 0 ${spacing[2]}`,
              }}
            >
              Upload the documents you already have — energy bills, production logs, invoices,
              delivery notes — and this page fills itself in.
            </p>
            <Link
              href="/upload"
              style={{
                padding: '10px 20px',
                backgroundColor: colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                borderRadius: '4px',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Upload documents
            </Link>
          </div>
        </section>
      )}

      {/* 5. Record store and recent movement, side by side — reference, not action. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: spacing[3] }}>
        {matrix.length > 0 && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] }}>
              <span style={sectionLabel}>Record store</span>
              <Link
                href="/records"
                style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none' }}
              >
                All records
              </Link>
            </div>
            <div
              style={{
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                    <th style={colStyle}>Type</th>
                    <th style={{ ...colStyle, color: colours.green }}>Verified</th>
                    <th style={{ ...colStyle, color: colours.amber }}>Declared</th>
                    <th style={{ ...colStyle, color: colours.textTertiary }}>Estimated</th>
                    <th style={{ ...colStyle, textAlign: 'right' as const }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, i) => (
                    <tr
                      key={row.domain}
                      style={{ borderBottom: i < matrix.length - 1 ? `1px solid ${colours.border}` : 'none' }}
                    >
                      <td style={{ ...cellStyle, fontWeight: typography.weights.medium }}>
                        {DOMAIN_LABELS[row.domain] ?? row.domain}
                      </td>
                      <td style={cellStyle}>
                        {row.A > 0
                          ? <span style={{ color: colours.green, fontWeight: typography.weights.medium }}>{row.A}</span>
                          : <span style={{ color: colours.textTertiary }}>0</span>}
                      </td>
                      <td style={cellStyle}>
                        {row.B > 0
                          ? <span style={{ color: colours.amber }}>{row.B}</span>
                          : <span style={{ color: colours.textTertiary }}>0</span>}
                      </td>
                      <td style={cellStyle}>
                        <span style={{ color: colours.textTertiary }}>{row.C}</span>
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right' as const, fontWeight: typography.weights.medium, color: colours.textSecondary }}>
                        {row.total}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                    <td style={{ ...cellStyle, fontWeight: typography.weights.medium, color: colours.textSecondary }}>Total</td>
                    <td style={{ ...cellStyle, color: colours.green, fontWeight: typography.weights.medium }}>{verifiedCount}</td>
                    <td style={{ ...cellStyle, color: colours.amber }}>{declaredCount}</td>
                    <td style={{ ...cellStyle, color: colours.textTertiary }}>{estimatedCount}</td>
                    <td style={{ ...cellStyle, textAlign: 'right' as const, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                      {totalRecords}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {recentEntries.length > 0 && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] }}>
              <span style={sectionLabel}>Recent activity</span>
              <Link
                href="/activity"
                style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none' }}
              >
                Full history
              </Link>
            </div>
            <div
              style={{
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              {recentEntries.map((entry, i) => (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: spacing[2],
                    padding: '10px 14px',
                    borderBottom: i < recentEntries.length - 1 ? `1px solid ${colours.border}` : 'none',
                  }}
                >
                  <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>
                    {EVENT_LABELS[entry.eventType] ?? entry.eventType}
                  </span>
                  <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, whiteSpace: 'nowrap' as const }}>
                    {relativeDay(new Date(entry.createdAt), now)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
