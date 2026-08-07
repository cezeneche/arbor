import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { NUMERIC_FIELDS } from '@/lib/review/review-policy'
import { currentDeclarationPeriod, lastPeriods } from '@/lib/layer3/declaration-period'
import { canonicalUnitIndex, findUnitConflicts } from '@/lib/layer3/unit-integrity'
import { buildAttention } from '@/lib/layer3/overview-attention'
import { buildOverviewTotals } from '@/lib/layer3/overview-totals'
import { buildCoverageMatrix, summariseCoverage } from '@/lib/layer3/coverage-matrix'
import { AttentionBlock, AttentionClear } from '@/components/overview/AttentionBlock'
import { CoverageMatrix } from '@/components/overview/CoverageMatrix'
import { ProvenanceBar } from '@/components/overview/ProvenanceBar'
import { SetupChecklist } from '@/components/overview/SetupChecklist'

// The Overview exists to show the difference between the data the org has and
// the data it owes. A value with no obligation attached does not earn space.
//
// Order: header, attention, totals, coverage, provenance, requests, activity.
//
// Below the low-data threshold none of that can say anything true, so the page
// switches to a setup checklist instead of styling an empty dashboard.

const LOW_DATA_THRESHOLD = 10
const COVERAGE_PERIODS = 8
const CONTENT_MAX_WIDTH = 1200
const RECENT_ACTIVITY_ROWS = 5

const sectionLabel = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textTertiary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  display: 'block',
  marginBottom: spacing[2],
}

const figure = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  fontVariantNumeric: 'tabular-nums' as const,
}

const EVENT_VERB: Record<string, string> = {
  CREATED: 'added',
  CREATED_VIA_SUBMISSION_LINK: 'added via a shared link',
  SUPERSEDED: 'replaced',
  CORRECTED: 'corrected',
  TIER_UPGRADED: 'upgraded',
  CHAIN_VERIFIED: 'checked the audit trail for',
}

function relativeTime(then: Date, now: Date): string {
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function quarterLabelOf(date: Date): string {
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string
  const now = new Date()
  const period = currentDeclarationPeriod(now)
  const periods = lastPeriods(now, COVERAGE_PERIODS)

  const [entity, records, documents, requests, auditEntries, disagreementRows] = await Promise.all([
    prisma.entity.findUnique({
      where: { id: entityId },
      select: { legalName: true, createdAt: true },
    }),
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true },
      select: {
        id: true, domain: true, fieldName: true, value: true, unit: true, trustTier: true,
        periodStart: true, periodEnd: true, submittedById: true,
        document: { select: { fileName: true } },
      },
    }),
    prisma.document.findMany({
      where: { entityId, status: { in: ['REVIEW_REQUIRED', 'REJECTED'] } },
      select: {
        id: true, fileName: true, status: true,
        extractionJobs: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          select: {
            errorMessage: true,
            extractedFields: { select: { fieldName: true, rawValue: true } },
          },
        },
      },
      take: 50,
    }),
    prisma.dataRequest.findMany({
      where: {
        status: 'PENDING',
        OR: [{ buyerEntityId: entityId }, { supplierEntityId: entityId }],
      },
      select: {
        id: true, domain: true, deadline: true, buyerEntityId: true,
        buyerEntity: { select: { legalName: true } },
        supplierEntity: { select: { legalName: true } },
      },
    }),
    prisma.auditEntry.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, eventType: true, createdAt: true, recordId: true },
      take: RECENT_ACTIVITY_ROWS,
    }),
    prisma.crossValidationResult.findMany({
      where: { entityId, passed: false, resolvedAt: null },
      select: { fieldName: true, discrepancyPercent: true },
      take: 20,
    }),
  ])

  if (!entity) redirect('/login')

  // ── shared derivations ──────────────────────────────────────────────────────
  const canonical = canonicalUnitIndex()
  const unitConflicts = findUnitConflicts(
    records.map(r => ({ id: r.id, domain: r.domain, fieldName: r.fieldName, unit: r.unit })),
    canonical,
  )

  const reviewDocs = documents
    .filter(d => d.status === 'REVIEW_REQUIRED')
    .map(d => ({
      id: d.id,
      fileName: d.fileName,
      status: d.status,
      valueCount: (d.extractionJobs[0]?.extractedFields ?? []).filter(
        f => NUMERIC_FIELDS.has(f.fieldName) && f.rawValue,
      ).length,
    }))

  const attention = buildAttention({
    now,
    records: records.map(r => ({
      id: r.id, domain: r.domain, fieldName: r.fieldName, value: r.value, unit: r.unit,
      trustTier: r.trustTier as 'A' | 'B' | 'C',
      periodStart: r.periodStart, periodEnd: r.periodEnd,
    })),
    requests: requests.map(q => ({
      id: q.id,
      domain: q.domain,
      deadline: q.deadline,
      counterpartyName:
        q.buyerEntityId === entityId ? q.supplierEntity.legalName : q.buyerEntity.legalName,
    })),
    documents: [
      ...reviewDocs,
      ...documents
        .filter(d => d.status === 'REJECTED')
        .map(d => ({
          id: d.id,
          fileName: d.fileName,
          status: d.status,
          errorMessage: d.extractionJobs[0]?.errorMessage ?? null,
        })),
    ],
    unitConflicts,
    disagreements: disagreementRows,
  })

  const totalRecords = records.length
  const verified = records.filter(r => r.trustTier === 'A').length
  const declared = records.filter(r => r.trustTier === 'B').length
  const estimated = records.filter(r => r.trustTier === 'C').length

  const openRequests = requests.length
  const overdueRequests = requests.filter(q => q.deadline && new Date(q.deadline) < now).length
  const awaitingReview = reviewDocs.reduce((n, d) => n + d.valueCount, 0)

  const lowData = totalRecords < LOW_DATA_THRESHOLD

  // Actor for recent activity, resolved through the record each entry describes.
  const recordIds = [...new Set(auditEntries.map(e => e.recordId))]
  const actorRows = recordIds.length
    ? await prisma.dataRecord.findMany({
        where: { id: { in: recordIds } },
        select: { id: true, domain: true, periodStart: true, submittedBy: { select: { name: true } } },
      })
    : []
  const actorById = new Map(actorRows.map(r => [r.id, r]))

  const container: React.CSSProperties = {
    maxWidth: `${CONTENT_MAX_WIDTH}px`,
    margin: '0 auto',
    width: '100%',
  }

  return (
    <div style={container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacing[3],
          marginBottom: spacing[5],
        }}
      >
        <div>
          <h1
            style={{
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              margin: 0,
            }}
          >
            Overview
          </h1>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `6px 0 0`,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {entity.legalName} · {period.year} declaration year · {period.quarterLabel} closes in{' '}
            {period.daysToClose} day{period.daysToClose === 1 ? '' : 's'}
          </p>
        </div>
        {/* The one primary action on the page. */}
        <Link
          href="/upload"
          style={{
            padding: '10px 20px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            borderRadius: '3px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Upload documents
        </Link>
      </div>

      {lowData ? (
        <SetupChecklist
          typesStarted={[...new Set(records.map(r => r.domain))].map(d => ({
            label: d.charAt(0) + d.slice(1).toLowerCase().replace(/_/g, ' '),
            started: true,
          }))}
          openPeriods={periods.slice(-4).map(p => ({
            label: p.label,
            hasRecord: records.some(
              r => new Date(r.periodStart) <= p.end && new Date(r.periodEnd) >= p.start,
            ),
          }))}
          documentBacked={records.filter(r => r.document).length}
          totalRecords={totalRecords}
          threshold={LOW_DATA_THRESHOLD}
        />
      ) : (
        <>
          {/* ── Attention, three states, always this position ──────────────── */}
          {attention.state === 'blocking' && (
            <AttentionBlock heading="Needs you now" items={attention.blocking} tone="blocking" />
          )}
          {attention.state === 'attention' && (
            <AttentionBlock heading="Worth a look" items={attention.attention} tone="attention" />
          )}
          {attention.state === 'clear' && attention.clearLine && (
            <AttentionClear line={attention.clearLine} />
          )}

          {/* ── Totals ─────────────────────────────────────────────────────── */}
          <section style={{ marginBottom: spacing[5] }}>
            <span style={sectionLabel}>Totals for {period.year}</span>
            <div style={{ display: 'flex', gap: spacing[6], flexWrap: 'wrap' }}>
              {buildOverviewTotals(
                records.map(r => ({
                  id: r.id, domain: r.domain, fieldName: r.fieldName, value: r.value,
                  unit: r.unit, trustTier: r.trustTier as 'A' | 'B' | 'C', periodEnd: r.periodEnd,
                })),
                period.year,
              ).map(total => (
                <div key={total.key} style={{ minWidth: '160px' }}>
                  <div
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textTertiary,
                      marginBottom: '4px',
                    }}
                  >
                    {total.label}
                  </div>
                  <div style={figure}>
                    {total.value === null ? (
                      <span style={{ color: colours.textTertiary }}>—</span>
                    ) : (
                      <>
                        {total.value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                        <span
                          style={{
                            fontWeight: typography.weights.light,
                            color: colours.textSecondary,
                            marginLeft: '5px',
                          }}
                        >
                          {total.unit}
                        </span>
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textTertiary,
                      marginTop: '4px',
                    }}
                  >
                    {total.placeholderReason
                      ? total.placeholderReason
                      : total.tier
                        ? `${{ A: 'Verified', B: 'Declared', C: 'Estimated' }[total.tier]}${
                            total.conflictCount > 0
                              ? ` · ${total.conflictCount} in another unit, not counted`
                              : ''
                          }`
                        : 'Nothing recorded yet'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Attention items demoted below Totals when something is blocking. */}
          {attention.state === 'blocking' && attention.attention.length > 0 && (
            <AttentionBlock heading="Worth a look" items={attention.attention} tone="attention" />
          )}

          {/* ── Coverage ───────────────────────────────────────────────────── */}
          {(() => {
            const rows = buildCoverageMatrix({
              records: records.map(r => ({
                domain: r.domain,
                trustTier: r.trustTier as 'A' | 'B' | 'C',
                periodStart: r.periodStart,
                periodEnd: r.periodEnd,
                documentName: r.document?.fileName ?? null,
              })),
              periods,
              onboardedAt: entity.createdAt,
            })
            return <CoverageMatrix rows={rows} summary={summariseCoverage(rows)} />
          })()}

          {/* ── Provenance ─────────────────────────────────────────────────── */}
          <ProvenanceBar verified={verified} declared={declared} estimated={estimated} />
        </>
      )}

      {/* ── Requests and review — the loop that fills the repository ───────── */}
      {(openRequests > 0 || awaitingReview > 0) && (
        <section style={{ marginBottom: spacing[5] }}>
          <div style={{ display: 'flex', gap: spacing[6], flexWrap: 'wrap' }}>
            {openRequests > 0 && (
              <Link href="/requests" style={{ textDecoration: 'none' }}>
                <div style={{ ...sectionLabel, marginBottom: '4px' }}>Requests</div>
                <div style={figure}>
                  {openRequests} open
                  {overdueRequests > 0 && (
                    <span style={{ color: colours.red, fontWeight: typography.weights.light }}>
                      {' · '}{overdueRequests} overdue
                    </span>
                  )}
                </div>
              </Link>
            )}
            {awaitingReview > 0 && (
              <Link href="/review" style={{ textDecoration: 'none' }}>
                <div style={{ ...sectionLabel, marginBottom: '4px' }}>Awaiting review</div>
                <div style={figure}>{awaitingReview} records</div>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Recent activity ────────────────────────────────────────────────── */}
      {auditEntries.length > 0 && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={sectionLabel}>Recent activity</span>
            <Link
              href="/activity"
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
              }}
            >
              Full history
            </Link>
          </div>
          <div style={{ borderTop: `0.5px solid ${colours.border}` }}>
            {auditEntries.map(entry => {
              const record = actorById.get(entry.recordId)
              const actor = record?.submittedBy?.name ?? 'Someone'
              const object = record
                ? `${quarterLabelOf(new Date(record.periodStart))} ${record.domain.toLowerCase().replace(/_/g, ' ')}`
                : 'a record'
              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: spacing[2],
                    padding: '9px 0',
                    borderBottom: `0.5px solid ${colours.border}`,
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textPrimary,
                  }}
                >
                  <span>
                    {actor} {EVENT_VERB[entry.eventType] ?? 'changed'} {object}
                  </span>
                  <span style={{ color: colours.textTertiary, whiteSpace: 'nowrap' }}>
                    {relativeTime(new Date(entry.createdAt), now)}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
