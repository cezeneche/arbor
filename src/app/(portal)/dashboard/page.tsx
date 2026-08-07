import Link from 'next/link'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { getSessionUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'
import { summariseCorrections } from '@/lib/confidence/correction-summary'
import { summariseOperationalPosition } from '@/lib/layer3/overview-summary'

const DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

const TIER_COLOURS: Record<string, string> = {
  A: colours.green,
  B: colours.amber,
  C: colours.textTertiary,
}

const TIER_LABELS: Record<string, string> = {
  A: 'Verified',
  B: 'Declared',
  C: 'Estimated',
}

// How many headline figures fit before the screen stops being a glance.
const HEADLINE_LIMIT = 6

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

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string

  const now = new Date()
  const [entity, allRecords, expiringDocs, staleRecords, reviewLabels] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { entityType: true } }),
    // One read serves both the headline figures and the domain × tier matrix.
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true },
      select: {
        domain: true, fieldName: true, trustTier: true,
        value: true, unit: true, periodStart: true, periodEnd: true,
      },
    }),
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
    // the user's review decisions, for agency reinforcement.
    prisma.groundTruthLabel.findMany({
      where: { entityId },
      select: { source: true, wasCorrect: true },
      take: 5000,
    }),
  ])

  const corrections = summariseCorrections(reviewLabels)

  // Suppliers see plain English certification; buyers keep the technical form.
  const isSupplier = entity?.entityType !== 'BUYER'

  // What the company's own documents say it used, made, moved and declared this
  // year. A roll-up of stored values only — never a derived or converted figure.
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

  // build a plain-English "needs attention" list (certificate expiry + staleness).
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
      text: `Your ${label} for the period ending ${rec.staleAfterDate ? new Date(rec.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} is now stale - upload a current document to refresh it.`,
    })
  }

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
        <h1
          style={textStyles.pageTitle}
        >
          Overview
        </h1>
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

      {/* agency reinforcement: reflect the user's review vigilance
          back to them so trust stays calibrated, not automatic. */}
      {corrections.reviewed > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <div
            style={{
              backgroundColor: colours.greenBg,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[3],
              display: 'flex',
              alignItems: 'baseline',
              gap: spacing[3],
              flexWrap: 'wrap' as const,
            }}
          >
            <span style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.green }}>
              {corrections.reviewed.toLocaleString('en-GB')} checked
              {corrections.corrected > 0 && (
                <span style={{ color: colours.textSecondary }}>
                  {' · '}
                  {corrections.corrected.toLocaleString('en-GB')} corrected
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                lineHeight: typography.lineHeight.body,
                flex: 1,
                minWidth: '260px',
              }}
            >
              {corrections.corrected > 0
                ? 'Your checks catch values the reader gets wrong — and every correction helps Arbor read your next document more accurately.'
                : 'Thanks for checking your extracted values. Your review is what keeps every record accurate.'}
            </span>
          </div>
        </section>
      )}


      {/* Needs attention: certificate expiry + batch staleness. Shown only when non-empty. */}
      {attentionItems.length > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.amber,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase' as const,
              display: 'block',
              marginBottom: spacing[1],
            }}
          >
            Needs attention
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

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: spacing[4], flexWrap: 'wrap' as const }}>
        {[
          { label: 'Total records', value: totalRecords.toLocaleString(), sub: undefined, col: undefined },
          {
            label: 'Verified',
            value: `${verifiedPct}%`,
            sub: `${verifiedCount.toLocaleString()} of ${totalRecords.toLocaleString()}`,
            col: verifiedPct >= 75 ? colours.green : verifiedPct >= 40 ? colours.amber : totalRecords > 0 ? colours.red : undefined,
          },
          { label: 'Domains', value: String(matrix.length), sub: `of ${DOMAINS.length} total`, col: undefined },
          {
            label: 'Latest year',
            value: position.reportingYear ? String(position.reportingYear) : '—',
            sub: position.reportingYear
              ? `${position.recordsInPeriod.toLocaleString()} record${position.recordsInPeriod === 1 ? '' : 's'}`
              : 'no records yet',
            col: undefined,
          },
        ].map(({ label, value, sub, col }) => (
          <div
            key={label}
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              padding: `${spacing[2]} ${spacing[2]}`,
              flex: 1,
              minWidth: '120px',
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
              {label}
            </div>
            <div
              style={{
                fontSize: '28px',
                fontWeight: typography.weights.medium,
                color: col ?? colours.textPrimary,
                letterSpacing: typography.tracking.tight,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {value}
            </div>
            {sub && (
              <div
                style={{
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textTertiary,
                  marginTop: '4px',
                }}
              >
                {sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* What your documents say — the figures a customer asks for, as recorded.
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
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: colours.textSecondary,
                letterSpacing: typography.tracking.wider,
                textTransform: 'uppercase' as const,
              }}
            >
              What your records say for {position.reportingYear}
            </span>
            <Link
              href="/records"
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
              }}
            >
              All records
            </Link>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
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

      {/* Domain x Tier matrix */}
      {matrix.length > 0 && (
        <section style={{ marginBottom: spacing[4] }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing[1],
            }}
          >
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: colours.textSecondary,
                letterSpacing: typography.tracking.wider,
                textTransform: 'uppercase',
              }}
            >
              Record store
            </span>
            <Link
              href="/records"
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
              }}
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
                  <th style={colStyle}>Domain</th>
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
                    style={{
                      borderBottom: i < matrix.length - 1 ? `1px solid ${colours.border}` : 'none',
                    }}
                  >
                    <td style={{ ...cellStyle, fontWeight: typography.weights.medium }}>
                      {DOMAIN_LABELS[row.domain] ?? row.domain}
                    </td>
                    <td style={cellStyle}>
                      {row.A > 0 ? (
                        <span style={{ color: colours.green, fontWeight: typography.weights.medium }}>
                          {row.A}
                        </span>
                      ) : (
                        <span style={{ color: colours.textTertiary }}>0</span>
                      )}
                    </td>
                    <td style={cellStyle}>
                      {row.B > 0 ? (
                        <span style={{ color: colours.amber }}>{row.B}</span>
                      ) : (
                        <span style={{ color: colours.textTertiary }}>0</span>
                      )}
                    </td>
                    <td style={cellStyle}>
                      {row.C > 0 ? (
                        <span style={{ color: colours.textTertiary }}>{row.C}</span>
                      ) : (
                        <span style={{ color: colours.textTertiary }}>0</span>
                      )}
                    </td>
                    <td
                      style={{
                        ...cellStyle,
                        textAlign: 'right' as const,
                        fontWeight: typography.weights.medium,
                        color: colours.textSecondary,
                      }}
                    >
                      {row.total}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                  <td
                    style={{
                      ...cellStyle,
                      fontWeight: typography.weights.medium,
                      color: colours.textSecondary,
                    }}
                  >
                    Total
                  </td>
                  <td style={{ ...cellStyle, color: colours.green, fontWeight: typography.weights.medium }}>
                    {verifiedCount}
                  </td>
                  <td style={{ ...cellStyle, color: colours.amber }}>{declaredCount}</td>
                  <td style={{ ...cellStyle, color: colours.textTertiary }}>{estimatedCount}</td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: 'right' as const,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                    }}
                  >
                    {totalRecords}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {totalRecords === 0 && (
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
            <p
              style={{ ...textStyles.rowTitle, margin: `0 0 ${spacing[1]}` }}
            >
              No records in the store yet.
            </p>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: `0 0 ${spacing[2]}`,
              }}
            >
              Upload energy bills, production logs, invoices, or delivery notes to populate your data record.
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

      {/* Tier legend */}
      {totalRecords > 0 && (
        <div style={{ marginTop: spacing[3], display: 'flex', gap: spacing[3], flexWrap: 'wrap' as const }}>
          {(['A', 'B', 'C'] as const).map(tier => (
            <span
              key={tier}
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: TIER_COLOURS[tier],
                }}
              />
              {TIER_LABELS[tier]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
