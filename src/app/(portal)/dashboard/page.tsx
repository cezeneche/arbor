import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { Pagination, PAGE_SIZE } from '@/components/Pagination'

const DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

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

const DOC_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Queued',
  EXTRACTING: 'Processing',
  REVIEW_REQUIRED: 'Review required',
  ACCEPTED: 'Accepted',
  REJECTED: 'Failed',
}

const DOC_STATUS_COLOURS: Record<string, string> = {
  PENDING: colours.textTertiary,
  EXTRACTING: colours.navy,
  REVIEW_REQUIRED: colours.amber,
  ACCEPTED: colours.green,
  REJECTED: colours.red,
}

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const sp = await searchParams
  const reqPage = Math.max(1, parseInt(sp.reqPage ?? '1', 10))

  const [recentDocuments, [pendingRequests, totalPending], allRecords] = await Promise.all([
    prisma.document.findMany({
      where: { entityId },
      orderBy: { submittedAt: 'desc' },
      take: 8,
    }),
    Promise.all([
      prisma.dataRequest.findMany({
        where: { supplierEntityId: entityId, status: 'PENDING' },
        include: { buyerEntity: { select: { legalName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (reqPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.dataRequest.count({ where: { supplierEntityId: entityId, status: 'PENDING' } }),
    ]),
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true },
      select: { domain: true, trustTier: true },
    }),
  ])

  const reqTotalPages = Math.ceil(totalPending / PAGE_SIZE)

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
  const openRequestsCount = totalPending
  const reviewCount = recentDocuments.filter(d => d.status === 'REVIEW_REQUIRED').length

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
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
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
            label: 'Open requests',
            value: String(totalPending),
            sub: totalPending > 0 ? 'awaiting response' : 'none pending',
            col: totalPending > 0 ? colours.amber : undefined,
          },
          ...(reviewCount > 0
            ? [{ label: 'Review queue', value: String(reviewCount), sub: 'need attention', col: colours.amber }]
            : []),
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
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                color: colours.textPrimary,
                margin: `0 0 ${spacing[1]}`,
              }}
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
        {/* Open requests */}
        <section>
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
                textTransform: 'uppercase' as const,
              }}
            >
              Open requests
            </span>
            <Link
              href="/requests"
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
              }}
            >
              All requests
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
            {pendingRequests.length === 0 ? (
              <div style={{ padding: `${spacing[2]} 14px` }}>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textTertiary,
                    margin: 0,
                  }}
                >
                  No pending requests.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr
                    style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}
                  >
                    <th style={colStyle}>From</th>
                    <th style={colStyle}>Domain</th>
                    <th style={colStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map((req, i) => (
                    <tr
                      key={req.id}
                      style={{
                        borderBottom:
                          i < pendingRequests.length - 1 ? `1px solid ${colours.border}` : 'none',
                      }}
                    >
                      <td
                        style={{
                          ...cellStyle,
                          fontWeight: typography.weights.medium,
                          maxWidth: '140px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap' as const,
                        }}
                      >
                        {req.buyerEntity.legalName}
                      </td>
                      <td style={{ ...cellStyle, color: colours.textSecondary }}>
                        {DOMAIN_LABELS[req.domain] ?? req.domain}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right' as const }}>
                        <Link
                          href="/requests"
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.medium,
                            color: colours.navy,
                            textDecoration: 'none',
                            whiteSpace: 'nowrap' as const,
                          }}
                        >
                          Respond
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pagination
            page={reqPage}
            totalPages={reqTotalPages}
            buildUrl={(p) => p > 1 ? `/dashboard?reqPage=${p}` : '/dashboard'}
          />
        </section>

        {/* Document ingestion queue */}
        <section>
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
                textTransform: 'uppercase' as const,
              }}
            >
              Document queue
            </span>
          </div>
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            {recentDocuments.length === 0 ? (
              <div style={{ padding: `${spacing[2]} 14px` }}>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textTertiary,
                    margin: 0,
                  }}
                >
                  No documents submitted yet.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr
                    style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}
                  >
                    <th style={colStyle}>Document</th>
                    <th style={colStyle}>Date</th>
                    <th style={colStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDocuments.map((doc, i) => {
                    const statusLabel = DOC_STATUS_LABELS[doc.status] ?? doc.status
                    const statusColour = DOC_STATUS_COLOURS[doc.status] ?? colours.textTertiary
                    return (
                      <tr
                        key={doc.id}
                        style={{
                          borderBottom:
                            i < recentDocuments.length - 1 ? `1px solid ${colours.border}` : 'none',
                        }}
                      >
                        <td
                          style={{
                            ...cellStyle,
                            maxWidth: '160px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap' as const,
                          }}
                          title={doc.fileName}
                        >
                          {doc.status === 'REVIEW_REQUIRED' ? (
                            <Link
                              href={`/upload/${doc.id}/review`}
                              style={{
                                color: colours.navy,
                                textDecoration: 'none',
                                fontWeight: typography.weights.medium,
                              }}
                            >
                              {doc.fileName}
                            </Link>
                          ) : (
                            doc.fileName
                          )}
                        </td>
                        <td
                          style={{
                            ...cellStyle,
                            color: colours.textTertiary,
                            whiteSpace: 'nowrap' as const,
                          }}
                        >
                          {new Date(doc.submittedAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </td>
                        <td
                          style={{
                            ...cellStyle,
                            color: statusColour,
                            fontWeight: typography.weights.medium,
                            whiteSpace: 'nowrap' as const,
                          }}
                        >
                          {statusLabel}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

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
