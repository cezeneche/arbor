import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

const DOMAINS = ['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']
const TIERS = ['A', 'B', 'C']

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const sp = await searchParams
  const domainFilter = sp.domain ?? null
  const tierFilter = sp.tier ?? null

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domainFilter ? { domain: domainFilter as never } : {}),
      ...(tierFilter ? { trustTier: tierFilter as never } : {}),
    },
    include: {
      document: { select: { id: true, fileName: true, documentType: true } },
      validationFlags: { where: { resolvedAt: null } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 100,
  })

  const filterLinkStyle = (active: boolean) => ({
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: typography.sizes.sm,
    fontWeight: active ? typography.weights.medium : typography.weights.light,
    color: active ? colours.navy : colours.textSecondary,
    backgroundColor: active ? colours.background : 'transparent',
    border: active ? `1px solid ${colours.border}` : '1px solid transparent',
    textDecoration: 'none',
    display: 'inline-block',
  })

  function buildFilterUrl(params: Record<string, string | null>) {
    const sp = new URLSearchParams()
    if (params.domain) sp.set('domain', params.domain)
    if (params.tier) sp.set('tier', params.tier)
    return `/records${sp.toString() ? '?' + sp.toString() : ''}`
  }

  return (
    <div>
      <div style={{ marginBottom: spacing[4] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Records
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          {records.length} active records
          {domainFilter ? ` · ${DOMAIN_LABELS[domainFilter] ?? domainFilter}` : ''}
          {tierFilter ? ` · Tier ${tierFilter}` : ''}
        </p>
      </div>

      <div style={{ display: 'flex', gap: spacing[3], marginBottom: spacing[4] }}>
        <div>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              margin: `0 0 6px`,
            }}
          >
            Domain
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <Link
              href={buildFilterUrl({ domain: null, tier: tierFilter })}
              style={filterLinkStyle(!domainFilter)}
            >
              All
            </Link>
            {DOMAINS.map(d => (
              <Link
                key={d}
                href={buildFilterUrl({ domain: d, tier: tierFilter })}
                style={filterLinkStyle(domainFilter === d)}
              >
                {DOMAIN_LABELS[d]}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              margin: `0 0 6px`,
            }}
          >
            Trust tier
          </p>
          <div style={{ display: 'flex', gap: '6px' }}>
            <Link
              href={buildFilterUrl({ domain: domainFilter, tier: null })}
              style={filterLinkStyle(!tierFilter)}
            >
              All
            </Link>
            {TIERS.map(t => (
              <Link
                key={t}
                href={buildFilterUrl({ domain: domainFilter, tier: t })}
                style={filterLinkStyle(tierFilter === t)}
              >
                Tier {t}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <div
          style={{
            padding: spacing[6],
            textAlign: 'center',
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: 0,
            }}
          >
            No records yet.
          </p>
          <Link
            href="/upload"
            style={{
              display: 'inline-block',
              marginTop: spacing[2],
              padding: '10px 20px',
              backgroundColor: colours.navy,
              color: colours.surface,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              borderRadius: '4px',
              textDecoration: 'none',
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
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${colours.border}`,
                  backgroundColor: colours.background,
                }}
              >
                {['Field', 'Value', 'Period', 'Domain', 'Trust tier', 'Flags', 'Source'].map(col => (
                  <th
                    key={col}
                    style={{
                      padding: '10px 16px',
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.textSecondary,
                      letterSpacing: typography.tracking.wider,
                      textTransform: 'uppercase',
                      textAlign: 'left',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record, i) => {
                const openFlags = record.validationFlags.filter(f => !f.resolvedAt)
                const hasCritical = openFlags.some(f => f.severity === 'CRITICAL')
                return (
                  <tr
                    key={record.id}
                    style={{
                      borderBottom: i < records.length - 1 ? `1px solid ${colours.border}` : 'none',
                      backgroundColor: hasCritical ? colours.redBg : 'transparent',
                    }}
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        color: colours.textPrimary,
                      }}
                    >
                      {record.fieldName.replace(/_/g, ' ')}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textPrimary,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {record.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {record.unit}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(record.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      {' – '}
                      {new Date(record.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        textTransform: 'capitalize',
                      }}
                    >
                      {DOMAIN_LABELS[record.domain] ?? record.domain}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <TierBadge tier={record.trustTier} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {openFlags.length > 0 ? (
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.medium,
                            color: hasCritical ? colours.red : colours.amber,
                          }}
                        >
                          {openFlags.length} {hasCritical ? 'critical' : 'warning'}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.textTertiary,
                          }}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {record.document ? (
                        <Link
                          href={`/upload/${record.document.id}/review`}
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.navy,
                            textDecoration: 'none',
                            maxWidth: '150px',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={record.document.fileName}
                        >
                          {record.document.fileName}
                        </Link>
                      ) : (
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.textTertiary,
                          }}
                        >
                          Manual entry
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
