import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'
import { Pagination, PAGE_SIZE } from '@/components/Pagination'
import { RecordsQueryPanel } from '@/components/RecordsQueryPanel'
import { RecordQualitySummary } from '@/components/RecordQualitySummary'
import { RecordTrends } from '@/components/RecordTrends'
import { summariseRecordQuality } from '@/lib/layer3/record-quality'
import { buildRecordTrends } from '@/lib/layer3/record-trends'
import { getCompulsoryFieldsByDomain } from '@/lib/layer3/compulsory-fields'
import { tierLabel } from '@/lib/tier-label'

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
  const page = Math.max(1, parseInt(sp.page ?? '1', 10))
  const view = sp.view === 'trends' ? 'trends' : 'records'

  const where = {
    entityId,
    isActive: true,
    ...(domainFilter ? { domain: domainFilter as never } : {}),
    ...(tierFilter ? { trustTier: tierFilter as never } : {}),
  }

  const [records, total, summaryRecords, entity] = await Promise.all([
    prisma.dataRecord.findMany({
      where,
      include: {
        document: { select: { id: true, fileName: true, documentType: true } },
        validationFlags: { where: { resolvedAt: null } },
      },
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.dataRecord.count({ where }),
    // Lightweight read across the full filtered set for the data-quality summary.
    prisma.dataRecord.findMany({
      where,
      select: { domain: true, fieldName: true, trustTier: true, staleAfterDate: true },
    }),
    prisma.entity.findUnique({ where: { id: entityId }, select: { entityType: true } }),
  ])

  // Suppliers see plain English (no tier codes); buyers see full technical detail.
  const isSupplier = entity?.entityType !== 'BUYER'

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const quality = summariseRecordQuality(
    summaryRecords.map(r => ({
      domain: r.domain,
      fieldName: r.fieldName,
      trustTier: r.trustTier as 'A' | 'B' | 'C',
      staleAfterDate: r.staleAfterDate,
    })),
    getCompulsoryFieldsByDomain(),
  )

  // Trends is a secondary view of the same data — fetched only when selected, over
  // the entity's full active history (trends need every quarter, not one page).
  const trends = view === 'trends'
    ? buildRecordTrends(
        (await prisma.dataRecord.findMany({
          where: { entityId, isActive: true },
          select: { domain: true, fieldName: true, trustTier: true, value: true, unit: true, periodStart: true },
          orderBy: { periodStart: 'asc' },
        })).map(r => ({
          domain: r.domain,
          fieldName: r.fieldName,
          trustTier: r.trustTier as 'A' | 'B' | 'C',
          value: r.value,
          unit: r.unit,
          periodStart: r.periodStart,
        })),
        getCompulsoryFieldsByDomain(),
      )
    : null

  const viewToggleStyle = (active: boolean) => ({
    fontSize: typography.sizes.sm,
    fontWeight: active ? typography.weights.medium : typography.weights.light,
    color: active ? colours.textPrimary : colours.textSecondary,
    textDecoration: 'none',
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
    const qs = new URLSearchParams()
    if (params.domain) qs.set('domain', params.domain)
    if (params.tier) qs.set('tier', params.tier)
    return `/records${qs.toString() ? '?' + qs.toString() : ''}`
  }

  function buildPageUrl(p: number) {
    const qs = new URLSearchParams()
    if (domainFilter) qs.set('domain', domainFilter)
    if (tierFilter) qs.set('tier', tierFilter)
    if (p > 1) qs.set('page', String(p))
    return `/records${qs.toString() ? '?' + qs.toString() : ''}`
  }

  return (
    <RecordsQueryPanel plainTiers={isSupplier}>
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[4] }}>
        <div>
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
            {total.toLocaleString()} active record{total !== 1 ? 's' : ''}
            {domainFilter ? ` · ${DOMAIN_LABELS[domainFilter] ?? domainFilter}` : ''}
            {tierFilter ? ` · ${isSupplier ? tierLabel(tierFilter as 'A' | 'B' | 'C', { plain: true }) : `Tier ${tierFilter}`}` : ''}
          </p>
        </div>
        <Link
          href="/api/audit-package/me"
          style={{
            padding: '10px 20px',
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '4px',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Download audit package
        </Link>
      </div>

      <RecordQualitySummary summary={quality} />

      {/* Records (default) and Trends are two views of the same data — a quiet
          toggle, not tabs. The table stays the primary view. */}
      <div style={{ display: 'flex', gap: spacing[3], marginBottom: spacing[4], paddingBottom: spacing[2], borderBottom: `1px solid ${colours.border}` }}>
        <Link href="/records" style={viewToggleStyle(view === 'records')}>Records</Link>
        <Link href="/records?view=trends" style={viewToggleStyle(view === 'trends')}>Trends</Link>
      </div>

      {view === 'trends' ? (
        <RecordTrends trends={trends!} />
      ) : (
      <>
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
            <Link href={buildFilterUrl({ domain: null, tier: tierFilter })} style={filterLinkStyle(!domainFilter)}>
              All
            </Link>
            {DOMAINS.map(d => (
              <Link key={d} href={buildFilterUrl({ domain: d, tier: tierFilter })} style={filterLinkStyle(domainFilter === d)}>
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
            {isSupplier ? 'Certification' : 'Trust tier'}
          </p>
          <div style={{ display: 'flex', gap: '6px' }}>
            <Link href={buildFilterUrl({ domain: domainFilter, tier: null })} style={filterLinkStyle(!tierFilter)}>
              All
            </Link>
            {TIERS.map(t => (
              <Link key={t} href={buildFilterUrl({ domain: domainFilter, tier: t })} style={filterLinkStyle(tierFilter === t)}>
                {isSupplier ? tierLabel(t as 'A' | 'B' | 'C', { plain: true }) : `Tier ${t}`}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div
          style={{
            padding: spacing[6],
            textAlign: 'center',
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
          }}
        >
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
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
        <>
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
                <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                  {['Field', 'Value', 'Period', 'Domain', isSupplier ? 'Certification' : 'Trust tier', 'Flags', 'Source'].map(col => (
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
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                        {record.fieldName.replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                        {record.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {record.unit}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' }}>
                        {new Date(record.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        {' – '}
                        {new Date(record.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, textTransform: 'capitalize' }}>
                        {DOMAIN_LABELS[record.domain] ?? record.domain}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <TierBadge tier={record.trustTier} plain={isSupplier} />
                        {record.trustTier === 'B' && (
                          <Link href="/upload" style={{ display: 'block', marginTop: '4px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                            Upload to verify ↑
                          </Link>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {openFlags.length > 0 ? (
                          <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: hasCritical ? colours.red : colours.amber }}>
                            {openFlags.length} {hasCritical ? 'critical' : 'warning'}
                          </span>
                        ) : (
                          <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>none</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {record.document ? (
                          <Link
                            href={`/upload/${record.document.id}/review`}
                            style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none', maxWidth: '150px', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={record.document.fileName}
                          >
                            {record.document.fileName}
                          </Link>
                        ) : (
                          <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>Manual entry</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} buildUrl={buildPageUrl} />
        </>
      )}
      </>
      )}
    </div>
    </RecordsQueryPanel>
  )
}
