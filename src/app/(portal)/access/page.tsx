import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { GrantAccessForm } from './GrantAccessForm'
import { RevokeAllForBuyer } from './RevokeAllForBuyer'

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

export default async function AccessPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const [grants, incomingRequests] = await Promise.all([
    prisma.dataAccessGrant.findMany({
      where: { grantorEntityId: entityId, isActive: true },
      include: { granteeEntity: { select: { legalName: true } } },
      orderBy: { grantedAt: 'desc' },
    }),
    prisma.dataRequest.findMany({
      where: { supplierEntityId: entityId },
      select: { buyerEntityId: true, buyerEntity: { select: { legalName: true } } },
      distinct: ['buyerEntityId'],
    }),
  ])

  const knownBuyers = incomingRequests.map(r => ({
    id: r.buyerEntityId,
    legalName: r.buyerEntity.legalName,
  }))

  // Gap 5.1 — group active grants by buyer so the supplier sees "who can see my data".
  type Grant = (typeof grants)[number]
  const byBuyer = new Map<string, { name: string; grants: Grant[] }>()
  for (const g of grants) {
    const entry = byBuyer.get(g.granteeEntityId) ?? { name: g.granteeEntity.legalName, grants: [] }
    entry.grants.push(g)
    byBuyer.set(g.granteeEntityId, entry)
  }
  const buyers = [...byBuyer.entries()]

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Access
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          {buyers.length === 0
            ? "You haven't shared your data with anyone yet. When a buyer requests access, you'll see them here."
            : `You are sharing your data with ${buyers.length} buyer${buyers.length !== 1 ? 's' : ''}.`}
        </p>
      </div>

      <GrantAccessForm knownBuyers={knownBuyers} />

      <section>
        <p style={sectionLabel}>Active data shares</p>

        {buyers.length === 0 ? (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[4],
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: 0,
              }}
            >
              No active data shares. When a buyer requests your data and you respond, access is created automatically.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {buyers.map(([granteeEntityId, info]) => {
              const earliest = info.grants.reduce(
                (min, g) => (g.grantedAt < min ? g.grantedAt : min),
                info.grants[0].grantedAt,
              )
              return (
                <div
                  key={granteeEntityId}
                  style={{
                    backgroundColor: colours.surface,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '8px',
                    padding: spacing[3],
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3] }}>
                    <div>
                      <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                        {info.name}
                      </p>
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                        First granted {new Date(earliest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {info.grants.length} share{info.grants.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <RevokeAllForBuyer granteeEntityId={granteeEntityId} buyerName={info.name} />
                  </div>

                  <div style={{ marginTop: spacing[2], display: 'flex', flexWrap: 'wrap' as const, gap: '8px' }}>
                    {info.grants.map((grant) => {
                      const scopeLabel = [
                        grant.domain ? (DOMAIN_LABELS[grant.domain] ?? grant.domain) : 'All domains',
                        grant.periodStart && grant.periodEnd
                          ? `${new Date(grant.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${new Date(grant.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
                          : 'All periods',
                      ].join(' · ')
                      return (
                        <span
                          key={grant.id}
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
                          {scopeLabel}
                        </span>
                      )
                    })}
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
