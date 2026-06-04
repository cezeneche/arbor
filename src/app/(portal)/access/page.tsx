import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { RevokeGrant } from './RevokeGrant'

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

export default async function AccessPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const grants = await prisma.dataAccessGrant.findMany({
    where: { grantorEntityId: entityId, isActive: true },
    include: { granteeEntity: { select: { legalName: true } } },
    orderBy: { grantedAt: 'desc' },
  })

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
          {grants.length === 0
            ? 'You have not shared your data with anyone.'
            : `You are sharing your data with ${grants.length} buyer${grants.length !== 1 ? 's' : ''}.`}
        </p>
      </div>

      <section>
        <p style={sectionLabel}>Active data shares</p>

        {grants.length === 0 ? (
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
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {grants.map((grant, i) => {
              const scopeLabel = [
                grant.domain ? (DOMAIN_LABELS[grant.domain] ?? grant.domain) : 'All domains',
                grant.periodStart && grant.periodEnd
                  ? `${new Date(grant.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${new Date(grant.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
                  : 'All periods',
              ].join(' · ')

              return (
                <div
                  key={grant.id}
                  style={{
                    padding: spacing[2],
                    borderBottom: i < grants.length - 1 ? `1px solid ${colours.border}` : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: spacing[3],
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
                      {grant.granteeEntity.legalName}
                    </p>
                    <p
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        margin: '2px 0 0',
                      }}
                    >
                      {scopeLabel}
                    </p>
                    <p
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.light,
                        color: colours.textTertiary,
                        margin: '4px 0 0',
                      }}
                    >
                      Granted {new Date(grant.grantedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <RevokeGrant
                    grantId={grant.id}
                    buyerName={grant.granteeEntity.legalName}
                    scopeLabel={scopeLabel}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
