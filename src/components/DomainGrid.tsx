import { colours, typography, spacing, trustTierConfig } from '@/lib/design-system'

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

export interface DomainStat {
  domain: string
  totalRecords: number
  tierA: number
  tierB: number
  tierC: number
  periodStart: string | null
  periodEnd: string | null
}

export function DomainGrid({ stats }: { stats: DomainStat[] }) {
  const ALL_DOMAINS = Object.keys(DOMAIN_LABELS)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: spacing[2],
      }}
    >
      {ALL_DOMAINS.map(domain => {
        const stat = stats.find(s => s.domain === domain)
        const hasData = stat && stat.totalRecords > 0

        return (
          <div
            key={domain}
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[3],
            }}
          >
            <p
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: colours.textSecondary,
                letterSpacing: typography.tracking.wider,
                textTransform: 'uppercase',
                margin: `0 0 ${spacing[1]}`,
              }}
            >
              {DOMAIN_LABELS[domain]}
            </p>

            {hasData ? (
              <>
                <p
                  style={{
                    fontSize: typography.sizes.lg,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    margin: `0 0 ${spacing[1]}`,
                    letterSpacing: typography.tracking.tight,
                  }}
                >
                  {stat.totalRecords}
                  <span
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      marginLeft: '4px',
                    }}
                  >
                    records
                  </span>
                </p>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {stat.tierA > 0 && (
                    <span
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: trustTierConfig.A.colour,
                        backgroundColor: trustTierConfig.A.bg,
                        padding: '1px 6px',
                        borderRadius: '3px',
                      }}
                    >
                      {stat.tierA}A
                    </span>
                  )}
                  {stat.tierB > 0 && (
                    <span
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: trustTierConfig.B.colour,
                        backgroundColor: trustTierConfig.B.bg,
                        padding: '1px 6px',
                        borderRadius: '3px',
                      }}
                    >
                      {stat.tierB}B
                    </span>
                  )}
                  {stat.tierC > 0 && (
                    <span
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: trustTierConfig.C.colour,
                        backgroundColor: trustTierConfig.C.bg,
                        padding: '1px 6px',
                        borderRadius: '3px',
                        border: `1px solid ${colours.border}`,
                      }}
                    >
                      {stat.tierC}C
                    </span>
                  )}
                </div>

                {stat.periodStart && stat.periodEnd && (
                  <p
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textTertiary,
                      margin: `${spacing[1]} 0 0`,
                    }}
                  >
                    {new Date(stat.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {' – '}
                    {new Date(stat.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  </p>
                )}
              </>
            ) : (
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textTertiary,
                  margin: 0,
                }}
              >
                No records
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
