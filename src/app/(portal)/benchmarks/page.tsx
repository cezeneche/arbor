import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { benchmarkPercentileRank } from '@/lib/aggregation/sector-benchmark'
import { BenchmarkConsent } from './BenchmarkConsent'

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

export default async function BenchmarksPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const [entity, entityRecords, benchmarks] = await Promise.all([
    prisma.entity.findUnique({
      where: { id: entityId },
      select: { legalName: true, sector: true, allowBenchmarkAggregation: true },
    }),
    prisma.dataRecord.groupBy({
      by: ['domain', 'fieldName', 'unit'],
      where: { entityId, isActive: true, trustTier: 'A' },
      _avg: { value: true },
    }),
    prisma.sectorBenchmark.findMany({
      where: { sector: (await prisma.entity.findUnique({ where: { id: entityId }, select: { sector: true } }))?.sector ?? '' },
      orderBy: [{ domain: 'asc' }, { fieldName: 'asc' }],
    }),
  ])

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  // Map entity averages by domain+fieldName for comparison
  const entityAverages = new Map(
    entityRecords.map(r => [`${r.domain}__${r.fieldName}`, r._avg.value ?? 0]),
  )

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Sector benchmarks
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          How your verified data compares to anonymised figures from other {entity?.sector} businesses.
          Benchmarks are computed from at least 10 verified records across different companies.
        </p>
      </div>

      {/* Consent banner */}
      <BenchmarkConsent entityId={entityId} initialConsent={entity?.allowBenchmarkAggregation ?? false} />

      {benchmarks.length === 0 ? (
        <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[5], textAlign: 'center', marginTop: spacing[4] }}>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0 }}>
            No sector benchmarks are available yet for {entity?.sector}.
          </p>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: `${spacing[1]} 0 0` }}>
            Benchmarks become available once at least 10 companies in the same sector have opted in to data sharing.
          </p>
        </div>
      ) : (
        <section style={{ marginTop: spacing[4] }}>
          <p style={sectionLabel}>Your figures vs sector</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {benchmarks.map(b => {
              const entityVal = entityAverages.get(`${b.domain}__${b.fieldName}`)
              const percentile = entityVal !== undefined
                ? benchmarkPercentileRank(entityVal, b)
                : null

              return (
                <div key={b.id} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[3] }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[2] }}>
                    <div>
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: 0 }}>
                        {DOMAIN_LABELS[b.domain] ?? b.domain}
                      </p>
                      <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: '2px 0 0' }}>
                        {b.fieldName.replace(/_/g, ' ')}
                      </p>
                    </div>
                    {percentile !== null && (
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: 0 }}>
                          Your position
                        </p>
                        <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: percentile < 50 ? colours.green : colours.amber, margin: '2px 0 0' }}>
                          {percentile < 50 ? `Lower than ${100 - percentile}%` : `Higher than ${percentile}%`} of {b.sector}
                        </p>
                      </div>
                    )}
                    {entityVal === undefined && (
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                        No Tier A record for this field
                      </p>
                    )}
                  </div>

                  {/* Benchmark bar */}
                  <div style={{ position: 'relative', height: '24px', backgroundColor: colours.background, borderRadius: '4px', overflow: 'hidden', border: `1px solid ${colours.border}` }}>
                    {/* Mean marker */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `${benchmarkPercentileRank(b.meanValue, b)}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        backgroundColor: colours.textTertiary,
                      }}
                    />
                    {/* Entity value marker */}
                    {entityVal !== undefined && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${Math.max(0, Math.min(98, benchmarkPercentileRank(entityVal, b)))}%`,
                          top: '2px',
                          bottom: '2px',
                          width: '4px',
                          backgroundColor: colours.navy,
                          borderRadius: '2px',
                        }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                    {[
                      { label: 'Min', value: b.minValue },
                      { label: 'Mean', value: b.meanValue },
                      { label: 'Max', value: b.maxValue },
                    ].map(stat => (
                      <div key={stat.label} style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>{stat.label}</p>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                          {stat.value.toLocaleString('en-GB', { maximumFractionDigits: 2 })} {b.unit}
                        </p>
                      </div>
                    ))}
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>Companies</p>
                      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, margin: 0 }}>{b.entityCount}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
