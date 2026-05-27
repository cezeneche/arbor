import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

export default async function SupplyChainPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const suppliers = await prisma.dataAccessGrant.findMany({
    where: { granteeEntityId: entityId, isActive: true },
    include: {
      grantorEntity: {
        include: {
          dataRecords: {
            where: { isActive: true },
            select: { domain: true, trustTier: true, periodEnd: true },
          },
          documents: {
            orderBy: { submittedAt: 'desc' },
            take: 1,
            select: { submittedAt: true },
          },
        },
      },
    },
    distinct: ['grantorEntityId'],
  })

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  const domains = ['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE'] as const

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
          <h1
            style={{
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              margin: 0,
              letterSpacing: typography.tracking.tight,
            }}
          >
            Supply chain
          </h1>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''} with data access grants
          </p>
        </div>
      </div>

      {suppliers.length === 0 ? (
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
            No suppliers have granted you data access yet.
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            Send a data request to a supplier to begin.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {suppliers.map(grant => {
            const supplier = grant.grantorEntity
            const records = supplier.dataRecords
            const lastDoc = supplier.documents[0]

            const domainCoverage = domains.map(domain => {
              const domainRecords = records.filter(r => r.domain === domain)
              const tierA = domainRecords.filter(r => r.trustTier === 'A').length
              const tierB = domainRecords.filter(r => r.trustTier === 'B').length
              const tierC = domainRecords.filter(r => r.trustTier === 'C').length
              return { domain, total: domainRecords.length, tierA, tierB, tierC }
            }).filter(d => d.total > 0)

            const totalRecords = records.length
            const tierACount = records.filter(r => r.trustTier === 'A').length
            const readinessScore = totalRecords > 0 ? Math.round((tierACount / totalRecords) * 100) : 0
            const readinessColour =
              readinessScore >= 75 ? colours.green :
              readinessScore >= 40 ? colours.amber :
              colours.red

            return (
              <div
                key={grant.grantorEntityId}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '6px',
                  padding: spacing[3],
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: spacing[2],
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
                      {supplier.legalName}
                    </p>
                    <p
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        margin: '2px 0 0',
                      }}
                    >
                      {supplier.country} · {supplier.sector}
                      {lastDoc && ` · Last submission ${new Date(lastDoc.submittedAt).toLocaleDateString('en-GB')}`}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: spacing[1], alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        color: readinessColour,
                        marginRight: spacing[2],
                      }}
                    >
                      {readinessScore}% Tier A
                    </span>
                    <Link
                      href={`/supply-chain/${grant.grantorEntityId}/records`}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'transparent',
                        border: `1px solid ${colours.border}`,
                        color: colours.textPrimary,
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        borderRadius: '4px',
                        textDecoration: 'none',
                      }}
                    >
                      View records
                    </Link>
                    <Link
                      href={`/supply-chain/request?supplierId=${grant.grantorEntityId}`}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: colours.navy,
                        color: colours.surface,
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        borderRadius: '4px',
                        textDecoration: 'none',
                      }}
                    >
                      Request data
                    </Link>
                  </div>
                </div>

                {domainCoverage.length > 0 && (
                  <div>
                    <p style={{ ...sectionLabel, marginBottom: spacing[1] }}>Domain coverage</p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {domainCoverage.map(d => (
                        <div
                          key={d.domain}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: colours.background,
                            border: `1px solid ${colours.border}`,
                            borderRadius: '4px',
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.textSecondary,
                          }}
                        >
                          {d.domain.replace(/_/g, ' ')} · {d.total} records
                          {d.tierA > 0 && <span style={{ color: colours.green }}> · {d.tierA} A</span>}
                          {d.tierB > 0 && <span style={{ color: colours.amber }}> · {d.tierB} B</span>}
                          {d.tierC > 0 && <span style={{ color: colours.textTertiary }}> · {d.tierC} C</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {domainCoverage.length === 0 && (
                  <p
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textTertiary,
                      margin: 0,
                    }}
                  >
                    No data records yet. Send a data request to start collecting.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
