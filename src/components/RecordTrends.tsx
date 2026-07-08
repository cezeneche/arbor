import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import type { RecordTrends as Trends } from '@/lib/layer3/record-trends'

const sectionLabel = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  margin: `0 0 ${spacing[2]}`,
}

function pctColour(pct: number) {
  return pct >= 75 ? colours.green : pct >= 40 ? colours.amber : colours.textTertiary
}

function tierPill(label: string, count: number, colour: string, bg: string) {
  if (count === 0) return null
  return (
    <span key={label} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colour, backgroundColor: bg, borderRadius: '3px', padding: '2px 7px', marginRight: '4px' }}>
      {count} {label}
    </span>
  )
}

export function RecordTrends({ trends }: { trends: Trends }) {
  if (trends.quarters.length === 0) {
    return (
      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
          No records yet - trends appear once you have data across more than one quarter.
        </p>
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      {/* ── Field coverage by quarter ── */}
      <section style={{ marginBottom: spacing[5] }}>
        <p style={sectionLabel}>Field coverage by quarter</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {trends.quarters.map(q => (
            <div key={q.quarter} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
              <p style={{ ...textStyles.rowTitle, margin: `0 0 12px` }}>{q.quarter}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {q.domains.map(d => (
                  <div key={d.domain}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <p style={textStyles.value}>
                          {DOMAIN_LABELS[d.domain] ?? d.domain}
                        </p>
                        <div style={{ marginTop: '3px' }}>
                          {tierPill('Verified', d.tiers.A, colours.green, colours.greenBg)}
                          {tierPill('Declared', d.tiers.B, colours.amber, colours.amberBg)}
                        </div>
                      </div>
                      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: pctColour(d.pct) }}>
                        {d.pct}%
                      </span>
                    </div>

                    {/* Compulsory field presence */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {[...d.presentFields.filter(f => !d.extraFields.includes(f)), ...d.missingFields].length === 0 ? null : (
                        <>
                          {d.presentFields.filter(f => !d.extraFields.includes(f)).map(f => (
                            <span key={f} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.green, backgroundColor: colours.greenBg, border: `1px solid ${colours.green}22`, borderRadius: '3px', padding: '2px 7px' }}>
                              ✓ {f.replace(/_/g, ' ')}
                            </span>
                          ))}
                          {d.missingFields.map(f => (
                            <span key={f} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.amber, backgroundColor: colours.amberBg, border: `1px solid ${colours.amber}22`, borderRadius: '3px', padding: '2px 7px' }}>
                              ✗ {f.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Extra fields beyond compulsory */}
                    {d.extraFields.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        {d.extraFields.map(f => (
                          <span key={f} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, backgroundColor: colours.background, border: `1px solid ${colours.border}`, borderRadius: '3px', padding: '2px 7px' }}>
                            + {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Period-over-period value comparison ── */}
      {trends.periodOverPeriod.length > 0 && (
        <section>
          <p style={sectionLabel}>Period-over-period comparison</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(
              trends.periodOverPeriod.reduce<Record<string, typeof trends.periodOverPeriod>>((acc, f) => {
                ;(acc[f.domain] ??= []).push(f)
                return acc
              }, {}),
            ).map(([domain, fields]) => {
              const quarters = [...new Set(fields.flatMap(f => f.points.map(p => p.quarter)))]
              const tierColour = (t: string) => (t === 'A' ? colours.green : t === 'B' ? colours.amber : colours.textTertiary)
              return (
                <div key={domain} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ padding: `10px ${spacing[2]}`, borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                    <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: 0 }}>
                      {DOMAIN_LABELS[domain] ?? domain}
                    </p>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colours.border}` }}>
                          <th style={{ padding: '8px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, textAlign: 'left', whiteSpace: 'nowrap' }}>Field</th>
                          {quarters.map(q => (
                            <th key={q} style={{ padding: '8px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, textAlign: 'right', whiteSpace: 'nowrap' }}>{q}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field, fi) => {
                          const pointMap = new Map(field.points.map(p => [p.quarter, p]))
                          return (
                            <tr key={field.fieldName} style={{ borderBottom: fi < fields.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                              <td style={{ padding: '10px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, whiteSpace: 'nowrap' }}>
                                {field.fieldName.replace(/_/g, ' ')}
                              </td>
                              {quarters.map(q => {
                                const pt = pointMap.get(q)
                                return (
                                  <td key={q} style={{ padding: '10px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                    {pt ? (
                                      <span>
                                        {pt.value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}{' '}
                                        <span style={{ fontSize: typography.sizes.xs, color: colours.textTertiary }}>{pt.unit}</span>{' '}
                                        <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: tierColour(pt.tier) }}>
                                          {pt.tier === 'A' ? '✓' : pt.tier === 'B' ? '~' : '?'}
                                        </span>
                                      </span>
                                    ) : (
                                      <span style={{ color: colours.textTertiary }}>-</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: `${spacing[2]} 0 0` }}>
            ✓ Verified · ~ Declared · ? Estimated. Figures are stored values. No calculations applied.
          </p>
        </section>
      )}
    </div>
  )
}
