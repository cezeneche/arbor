import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { GRANT_SCOPE_SELECT, anyGrantCoversRecord, toGrantScope } from '@/lib/layer3/grant-scope'
import { supplierReadiness } from '@/lib/readiness-score'

export default async function SupplyChainPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await requirePageSession()

  const entityId = getSessionUser(session).entityId as string
  const sp = await searchParams
  const expiringOnly = sp.expiring === '1'
  const now = new Date()

  const grants = await prisma.dataAccessGrant.findMany({
    where: { granteeEntityId: entityId, isActive: true, revokedAt: null },
    select: {
      grantorEntityId: true,
      ...GRANT_SCOPE_SELECT,
      grantorEntity: {
        select: {
          legalName: true,
          country: true,
          sector: true,
          dataRecords: {
            where: { isActive: true },
            select: { domain: true, fieldName: true, trustTier: true, periodEnd: true, periodStart: true, staleAfterDate: true },
          },
          documents: {
            orderBy: { submittedAt: 'desc' },
            take: 1,
            select: { submittedAt: true },
          },
        },
      },
    },
  })

  // What this buyer has asked each supplier for — the only thing a supplier can
  // be "ready" against.
  const requests = await prisma.dataRequest.findMany({
    where: { buyerEntityId: entityId, supplierEntityId: { in: [...new Set(grants.map(g => g.grantorEntityId))] } },
    select: { supplierEntityId: true, domain: true, periodStart: true, periodEnd: true, requiredFields: true },
  })

  // Group grants by supplier and build one summary row per supplier
  const supplierMap = new Map<string, typeof grants>()
  for (const g of grants) {
    const existing = supplierMap.get(g.grantorEntityId) ?? []
    existing.push(g)
    supplierMap.set(g.grantorEntityId, existing)
  }

  const suppliers = [...supplierMap.entries()].map(([grantorEntityId, supplierGrants]) => {
    const first = supplierGrants[0]
    // Records within the union of this supplier's grants, by the one shared
    // rule. The inline copy it replaces ignored field-scoped grants, so a
    // supplier's counts included fields they had not shared.
    const scopes = supplierGrants.map(toGrantScope)
    const allRecords = first.grantorEntity.dataRecords.filter(record => anyGrantCoversRecord(scopes, record))
    const readiness = supplierReadiness({
      requests: requests
        .filter(r => r.supplierEntityId === grantorEntityId)
        .map(r => ({
          ...r,
          requiredFields: Array.isArray(r.requiredFields)
            ? r.requiredFields.filter((f): f is string => typeof f === 'string')
            : [],
        })),
      records: allRecords,
    })
    const expiringCount = allRecords.filter(
      (r) => r.staleAfterDate && new Date(r.staleAfterDate) < now,
    ).length
    return { grantorEntityId, grantorEntity: { ...first.grantorEntity, dataRecords: allRecords }, expiringCount, readiness }
  })

  // buyer filter: show only suppliers with expiring/stale records.
  const visibleSuppliers = expiringOnly ? suppliers.filter((s) => s.expiringCount > 0) : suppliers
  const suppliersWithExpiring = suppliers.filter((s) => s.expiringCount > 0).length

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
            style={textStyles.pageTitle}
          >
            Supply chain
          </h1>
          <p
            style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
          >
            {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''} with data access grants
          </p>
        </div>
      </div>

      {/* filter to suppliers with expiring/stale records */}
      {suppliersWithExpiring > 0 && (
        <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[3] }}>
          <Link
            href="/supply-chain"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: expiringOnly ? typography.weights.light : typography.weights.medium,
              color: expiringOnly ? colours.textSecondary : colours.navy,
              textDecoration: 'none',
            }}
          >
            All suppliers
          </Link>
          <Link
            href="/supply-chain?expiring=1"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: expiringOnly ? typography.weights.medium : typography.weights.light,
              color: expiringOnly ? colours.amber : colours.textSecondary,
              textDecoration: 'none',
            }}
          >
            Expiring records ({suppliersWithExpiring})
          </Link>
        </div>
      )}

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
          {visibleSuppliers.map(grant => {
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

            // Completeness against what was asked, coloured by that alone.
            // Verification is a separate fact and is said separately.
            const readiness = grant.readiness
            const readinessColour = !readiness
              ? colours.textSecondary
              : readiness.supplied === readiness.requested
                ? colours.green
                : readiness.supplied > 0
                  ? colours.amber
                  : colours.red

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
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing[1],
                      }}
                    >
                      {supplier.legalName}
                      {grant.expiringCount > 0 && (
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.medium,
                            color: colours.amber,
                            backgroundColor: colours.amberBg,
                            border: `1px solid ${colours.amber}`,
                            borderRadius: '10px',
                            padding: '1px 8px',
                            letterSpacing: typography.tracking.normal,
                          }}
                        >
                          {grant.expiringCount} expiring
                        </span>
                      )}
                    </p>
                    <p
                      style={{ ...textStyles.sectionSubtitle, margin: '2px 0 0' }}
                    >
                      {supplier.country} · {supplier.sector}
                      {lastDoc && ` · Last submission ${new Date(lastDoc.submittedAt).toLocaleDateString('en-GB')}`}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: spacing[1], alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: readiness ? typography.weights.medium : typography.weights.light,
                        color: readinessColour,
                        marginRight: spacing[2],
                      }}
                    >
                      {readiness
                        ? `${readiness.supplied} of ${readiness.requested} requested figures supplied`
                        : 'Nothing requested yet'}
                      {readiness && readiness.supplied > 0 && (
                        <span style={{ fontWeight: typography.weights.light, color: colours.textSecondary }}>
                          {` · ${readiness.verified} Verified`}
                        </span>
                      )}
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
