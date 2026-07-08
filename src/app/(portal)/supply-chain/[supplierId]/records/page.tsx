import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'
import { TrustIndicator } from '@/components/TrustIndicator'
import type { ConfidencePosterior } from '@/lib/confidence/types'
import { logRecordAccess } from '@/lib/layer3/grant-access'

const DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

export default async function SupplierRecordsPage({
  params,
}: {
  params: Promise<{ supplierId: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { supplierId } = await params
  const buyerEntityId = getSessionUser(session).entityId as string

  const grants = await prisma.dataAccessGrant.findMany({
    where: { grantorEntityId: supplierId, granteeEntityId: buyerEntityId, isActive: true, revokedAt: null },
    include: { grantorEntity: { select: { legalName: true, country: true, sector: true } } },
  })

  if (grants.length === 0) notFound()

  const supplier = grants[0].grantorEntity

  const candidateRecords = await prisma.dataRecord.findMany({
    where: { entityId: supplierId, isActive: true },
    include: {
      validationFlags: { where: { resolvedAt: null } },
      document: { select: { id: true, fileName: true } },
    },
    orderBy: [{ domain: 'asc' }, { periodStart: 'desc' }],
  })

  // Enforce union of all grant scopes (domain + period) for this supplier
  const records = candidateRecords.filter(record =>
    grants.some(grant => {
      const domainMatch = !grant.domain || grant.domain === record.domain
      const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
      const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
      return domainMatch && startMatch && endMatch
    })
  )

  // log this buyer's view of the supplier's records (PORTAL access).
  await logRecordAccess(records.map((r) => r.id), buyerEntityId, 'PORTAL')

  const byDomain = DOMAINS.map(domain => {
    const domainRecords = records.filter(r => r.domain === domain)
    return { domain, records: domainRecords }
  }).filter(d => d.records.length > 0)

  const totalRecords = records.length
  const tierACount = records.filter(r => r.trustTier === 'A').length
  const tierBCount = records.filter(r => r.trustTier === 'B').length
  const tierCCount = records.filter(r => r.trustTier === 'C').length

  const gapDomains = DOMAINS.filter(d => !byDomain.find(bd => bd.domain === d))

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[1]}`,
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: spacing[5],
        }}
      >
        <div>
          <Link
            href="/supply-chain"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              textDecoration: 'none',
              display: 'block',
              marginBottom: spacing[1],
            }}
          >
            ← Supply chain
          </Link>
          <h1
            style={textStyles.pageTitle}
          >
            {supplier.legalName}
          </h1>
          <p
            style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
          >
            {supplier.country} · {supplier.sector} · {totalRecords} records
          </p>
        </div>
        <Link
          href={`/supply-chain/request?supplierId=${supplierId}`}
          style={{
            padding: '12px 24px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            borderRadius: '4px',
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
          }}
        >
          Request data
        </Link>
      </div>

      <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[5] }}>
        {[
          { label: 'Tier A', count: tierACount, colour: colours.green },
          { label: 'Tier B', count: tierBCount, colour: colours.amber },
          { label: 'Tier C', count: tierCCount, colour: colours.textTertiary },
        ].map(({ label, count, colour }) => (
          <div
            key={label}
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[2],
              flex: 1,
            }}
          >
            <p style={{ ...sectionLabel, color: colour }}>{label}</p>
            <p
              style={{
                fontSize: '28px',
                fontWeight: typography.weights.medium,
                color: colour,
                margin: 0,
                letterSpacing: typography.tracking.tight,
              }}
            >
              {count}
            </p>
            <p
              style={{ ...textStyles.sectionSubtitle, margin: `2px 0 0` }}
            >
              {totalRecords > 0 ? Math.round((count / totalRecords) * 100) : 0}% of records
            </p>
          </div>
        ))}
      </div>

      {gapDomains.length > 0 && (
        <div
          style={{
            backgroundColor: colours.amberBg,
            border: `1px solid ${colours.amber}22`,
            borderRadius: '6px',
            padding: spacing[2],
            marginBottom: spacing[4],
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.amber,
              margin: `0 0 6px`,
            }}
          >
            Gap analysis: missing domains
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {gapDomains.map(domain => (
              <div
                key={domain}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 10px',
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '4px',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                }}
              >
                {domain.replace(/_/g, ' ')}
                <Link
                  href={`/supply-chain/request?supplierId=${supplierId}`}
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.navy,
                    textDecoration: 'none',
                  }}
                >
                  Request
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {byDomain.length === 0 ? (
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            padding: spacing[5],
            textAlign: 'center',
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
            No records shared yet.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[4] }}>
          {byDomain.map(({ domain, records: domainRecords }) => (
            <section key={domain}>
              <p style={sectionLabel}>{domain.replace(/_/g, ' ')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {domainRecords.map(record => {
                  const hasFlags = record.validationFlags.length > 0
                  const criticalFlags = record.validationFlags.filter(f => f.severity === 'CRITICAL')

                  return (
                    <div
                      key={record.id}
                      style={{
                        backgroundColor: colours.surface,
                        border: `1px solid ${hasFlags ? colours.amber : colours.border}`,
                        borderRadius: '6px',
                        padding: spacing[2],
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                          <TierBadge tier={record.trustTier as 'A' | 'B' | 'C'} />
                          <p
                            style={textStyles.sectionTitle}
                          >
                            {record.fieldName.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <p
                          style={textStyles.sectionSubtitle}
                        >
                          {record.value.toLocaleString()} {record.unit}
                          {' · '}
                          {new Date(record.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                          {' – '}
                          {new Date(record.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        </p>
                        {criticalFlags.length > 0 && (
                          <p
                            style={{
                              fontSize: typography.sizes.xs,
                              fontWeight: typography.weights.light,
                              color: colours.red,
                              margin: '4px 0 0',
                            }}
                          >
                            {criticalFlags[0].message}
                          </p>
                        )}
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <TrustIndicator
                          confidenceScore={record.confidenceScore}
                          confidencePosterior={record.confidencePosterior as ConfidencePosterior | null}
                          detail
                        />
                        {record.document && (
                          <p
                            style={{
                              fontSize: typography.sizes.xs,
                              fontWeight: typography.weights.light,
                              color: colours.textTertiary,
                              margin: '2px 0 0',
                            }}
                          >
                            {record.document.fileName}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
