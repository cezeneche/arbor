import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'

export default async function EmissionFactorsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const role = (session.user as Record<string, unknown>).role as string

  const factors = await prisma.emissionFactor.findMany({
    where: {
      isActive: true,
      OR: [{ entityId: null }, { entityId }],
    },
    orderBy: [{ isDerived: 'desc' }, { activityType: 'asc' }],
  })

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  const derived = factors.filter(f => f.isDerived)
  const global = factors.filter(f => !f.isDerived && !f.entityId)
  const custom = factors.filter(f => !f.isDerived && f.entityId)

  function FactorTable({ items, showCI }: { items: typeof factors; showCI?: boolean }) {
    if (items.length === 0) return (
      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>None.</p>
    )
    return (
      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: colours.background, borderBottom: `1px solid ${colours.border}` }}>
              {['Activity type', 'Factor', 'Unit', 'Source', 'Version', ...(showCI ? ['95% CI', 'Sample'] : [])].map(col => (
                <th key={col} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((f, i) => (
              <tr key={f.id} style={{ borderBottom: i < items.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>{f.activityType}</td>
                <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{f.factor.toLocaleString('en-GB', { maximumFractionDigits: 6 })}</td>
                <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>{f.unit}</td>
                <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>{f.source}</td>
                <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>{f.version}</td>
                {showCI && (
                  <>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {f.confidenceIntervalLower !== null && f.confidenceIntervalUpper !== null
                        ? `${f.confidenceIntervalLower!.toFixed(4)} – ${f.confidenceIntervalUpper!.toFixed(4)}`
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                      {f.sampleSize ?? '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[5] }}>
        <div>
          <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
            Emission factors
          </h1>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
            Factors applied when calculating CO₂e from activity data. Derived factors are statistically computed from verified Tier A records across the platform.
          </p>
        </div>
        {role === 'ADMIN' && (
          <form action="/api/admin/factors/derive" method="POST">
            <button
              type="submit"
              style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Recompute derived factors
            </button>
          </form>
        )}
      </div>

      {derived.length > 0 && (
        <section style={{ marginBottom: spacing[5] }}>
          <p style={sectionLabel}>Derived from Tier A dataset</p>
          <FactorTable items={derived} showCI />
        </section>
      )}

      {global.length > 0 && (
        <section style={{ marginBottom: spacing[5] }}>
          <p style={sectionLabel}>Published global factors (IPCC / DEFRA)</p>
          <FactorTable items={global} />
        </section>
      )}

      {custom.length > 0 && (
        <section>
          <p style={sectionLabel}>Your custom factors</p>
          <FactorTable items={custom} />
        </section>
      )}

      {factors.length === 0 && (
        <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
            No emission factors loaded yet.
          </p>
        </div>
      )}
    </div>
  )
}
