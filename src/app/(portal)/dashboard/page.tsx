import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { computeReadinessScore } from '@/lib/readiness-score'

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy',
  MATERIALS: 'Materials',
  PRODUCTION: 'Production',
  LOGISTICS: 'Logistics',
  EMISSIONS: 'Emissions',
  AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water',
  COMPLIANCE: 'Compliance',
}

const TIER_LABELS: Record<string, string> = {
  A: 'Verified',
  B: 'Declared',
  C: 'Estimated',
}

const TIER_COLOURS: Record<string, string> = {
  A: colours.green,
  B: colours.amber,
  C: colours.textTertiary,
}

const DOC_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Reading',
  EXTRACTING: 'Reading',
  REVIEW_REQUIRED: 'Needs your attention',
  ACCEPTED: 'Ready',
  REJECTED: 'Could not read',
}

const DOC_STATUS_COLOURS: Record<string, string> = {
  PENDING: colours.textTertiary,
  EXTRACTING: colours.textTertiary,
  REVIEW_REQUIRED: colours.amber,
  ACCEPTED: colours.green,
  REJECTED: colours.red,
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const [recentDocuments, pendingRequests, recentRecordGroups, allRecords] = await Promise.all([
    prisma.document.findMany({
      where: { entityId },
      orderBy: { submittedAt: 'desc' },
      take: 10,
    }),
    prisma.dataRequest.findMany({
      where: { supplierEntityId: entityId, status: 'PENDING' },
      include: { buyerEntity: { select: { legalName: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.dataRecord.groupBy({
      by: ['domain', 'trustTier', 'periodStart', 'periodEnd'],
      where: { entityId, isActive: true },
      _count: { id: true },
      orderBy: [{ periodEnd: 'desc' }],
      take: 20,
    }),
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true },
      select: { id: true, domain: true, trustTier: true },
    }),
  ])

  const readiness = computeReadinessScore({ records: allRecords.map(r => ({ id: r.id, domain: r.domain, trustTier: r.trustTier as 'A' | 'B' | 'C' })) })
  const readinessColour = readiness.interpretation === 'HIGH' ? colours.green : readiness.interpretation === 'MEDIUM' ? colours.amber : colours.red

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  // Collapse record groups into period buckets: { period -> { domain -> tier } }
  type PeriodEntry = { domain: string; tier: string; count: number; periodStart: Date; periodEnd: Date }
  const periodMap = new Map<string, PeriodEntry[]>()
  for (const g of recentRecordGroups) {
    const key = `${g.periodStart.toISOString()}__${g.periodEnd.toISOString()}`
    const existing = periodMap.get(key) ?? []
    existing.push({ domain: g.domain, tier: g.trustTier, count: g._count.id, periodStart: g.periodStart, periodEnd: g.periodEnd })
    periodMap.set(key, existing)
  }

  const periodEntries = Array.from(periodMap.entries())
    .map(([, entries]) => entries)
    .sort((a, b) => b[0].periodEnd.getTime() - a[0].periodEnd.getTime())
    .slice(0, 6)

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: spacing[5],
        }}
      >
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Your data
        </h1>
        <Link
          href="/upload"
          style={{
            padding: '12px 24px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            borderRadius: '4px',
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
            display: 'inline-block',
          }}
        >
          Upload documents
        </Link>
      </div>

      {/* ── READINESS SCORE (Phase 2 — shown once records exist) ────────────── */}
      {allRecords.length > 0 && (
        <section style={{ marginBottom: spacing[5] }}>
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[3],
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: spacing[4],
            }}
          >
            <div>
              <p style={{ ...sectionLabel, margin: `0 0 ${spacing[1]}` }}>Data readiness</p>
              <p
                style={{
                  fontSize: '36px',
                  fontWeight: typography.weights.medium,
                  color: readinessColour,
                  margin: 0,
                  letterSpacing: typography.tracking.tight,
                  lineHeight: 1,
                }}
              >
                {readiness.overallScore}%
              </p>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  margin: `${spacing[1]} 0 0`,
                }}
              >
                {readiness.interpretation} — {readiness.tierACount} of {readiness.totalRecords} records verified
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '6px', maxWidth: '460px', justifyContent: 'flex-end' }}>
              {readiness.byDomain.map(d => (
                <span
                  key={d.domain}
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    backgroundColor: colours.background,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '4px',
                    padding: '4px 10px',
                  }}
                >
                  {DOMAIN_LABELS[d.domain] ?? d.domain}
                  {' '}
                  <span style={{ fontWeight: typography.weights.medium, color: d.interpretation === 'HIGH' ? colours.green : d.interpretation === 'MEDIUM' ? colours.amber : colours.red }}>
                    {d.score}%
                  </span>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── SECTION 1: Requests ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: spacing[5] }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing[2],
          }}
        >
          <p style={{ ...sectionLabel, margin: 0 }}>Requests</p>
          <Link
            href="/requests"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.navy,
              textDecoration: 'none',
            }}
          >
            View all
          </Link>
        </div>

        {pendingRequests.length === 0 ? (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[3],
            }}
          >
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: 0,
              }}
            >
              No pending requests from customers.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pendingRequests.map(req => (
              <div
                key={req.id}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '6px',
                  padding: spacing[2],
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: typography.sizes.base,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                      margin: 0,
                    }}
                  >
                    {req.buyerEntity.legalName}
                  </p>
                  <p
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      margin: '2px 0 0',
                    }}
                  >
                    {DOMAIN_LABELS[req.domain] ?? req.domain}
                    {' · '}
                    {new Date(req.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {' – '}
                    {new Date(req.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {req.deadline &&
                      ` · Due ${new Date(req.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                  </p>
                </div>
                <Link
                  href="/requests"
                  style={{
                    padding: '8px 16px',
                    backgroundColor: colours.navy,
                    color: colours.surface,
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    borderRadius: '4px',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap' as const,
                  }}
                >
                  Respond
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── SECTION 2: Your data ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: spacing[5] }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing[2],
          }}
        >
          <p style={{ ...sectionLabel, margin: 0 }}>Your data</p>
          <Link
            href="/records"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.navy,
              textDecoration: 'none',
            }}
          >
            View all
          </Link>
        </div>

        {periodEntries.length === 0 ? (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[3],
            }}
          >
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: 0,
              }}
            >
              No data yet. Upload a document to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {periodEntries.map((entries, i) => {
              const { periodStart, periodEnd } = entries[0]
              const periodLabel = `${new Date(periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${new Date(periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
              return (
                <div
                  key={i}
                  style={{
                    backgroundColor: colours.surface,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '6px',
                    padding: spacing[2],
                  }}
                >
                  <p
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.textTertiary,
                      letterSpacing: typography.tracking.wide,
                      textTransform: 'uppercase',
                      margin: `0 0 ${spacing[1]}`,
                    }}
                  >
                    {periodLabel}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '6px' }}>
                    {entries.map(entry => (
                      <span
                        key={`${entry.domain}-${entry.tier}`}
                        style={{
                          fontSize: typography.sizes.sm,
                          fontWeight: typography.weights.light,
                          color: colours.textPrimary,
                          backgroundColor: colours.background,
                          border: `1px solid ${colours.border}`,
                          borderRadius: '4px',
                          padding: '4px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {DOMAIN_LABELS[entry.domain] ?? entry.domain}
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.medium,
                            color: TIER_COLOURS[entry.tier],
                          }}
                        >
                          {TIER_LABELS[entry.tier] ?? entry.tier}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── SECTION 3: Your documents ────────────────────────────────────────── */}
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing[2],
          }}
        >
          <p style={{ ...sectionLabel, margin: 0 }}>Your documents</p>
        </div>

        {recentDocuments.length === 0 ? (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[4],
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: `0 0 ${spacing[2]}`,
              }}
            >
              You have not uploaded any documents yet.
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
              Upload a document
            </Link>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {recentDocuments.map((doc, i) => {
              const statusLabel = DOC_STATUS_LABELS[doc.status] ?? doc.status.replace(/_/g, ' ')
              const statusColour = DOC_STATUS_COLOURS[doc.status] ?? colours.textTertiary
              const periodLabel = new Date(doc.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

              return (
                <div
                  key={doc.id}
                  style={{
                    padding: spacing[2],
                    borderBottom: i < recentDocuments.length - 1 ? `1px solid ${colours.border}` : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: typography.sizes.base,
                        fontWeight: typography.weights.medium,
                        color: colours.textPrimary,
                        margin: 0,
                      }}
                    >
                      {doc.fileName}
                    </p>
                    <p
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        margin: '2px 0 0',
                      }}
                    >
                      {periodLabel}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <span
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        color: statusColour,
                      }}
                    >
                      {statusLabel}
                    </span>
                    {doc.status === 'REVIEW_REQUIRED' && (
                      <Link
                        href={`/upload/${doc.id}/review`}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: colours.navy,
                          color: colours.surface,
                          fontSize: typography.sizes.sm,
                          fontWeight: typography.weights.medium,
                          borderRadius: '4px',
                          textDecoration: 'none',
                        }}
                      >
                        Review
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
