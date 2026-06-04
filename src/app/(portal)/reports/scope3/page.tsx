'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

interface CategoryResult {
  category: number
  name: string
  totalKgCo2e: number
  byTier: { A: number; B: number; C: number }
  recordCount: number
  isMixedMethod: boolean
  dataComplete: boolean
}

interface Scope3Result {
  inventory: {
    categories: CategoryResult[]
    totalKgCo2e: number
    coverageReport: {
      fullyDataComplete: number[]
      partiallyEstimated: number[]
      notCovered: number[]
    }
    mixedMethodCategories: number[]
    gapClosePathway: Array<{ category: number; tierCVolume: number }>
  }
  recordCount: number
}

const TIER_COLOURS = { A: colours.green, B: colours.amber, C: colours.textTertiary }
const COVERAGE_LABELS: Record<string, string> = {
  fullyDataComplete: 'Fully verified',
  partiallyEstimated: 'Partially estimated',
  notCovered: 'Not covered',
}

export default function Scope3ReportPage() {
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [result, setResult] = useState<Scope3Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    const params = new URLSearchParams()
    if (periodStart) params.set('periodStart', new Date(periodStart).toISOString())
    if (periodEnd) params.set('periodEnd', new Date(periodEnd).toISOString())
    const res = await fetch(`/api/reports/scope3?${params}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Could not generate report.'); setLoading(false); return }
    setResult(data)
    setLoading(false)
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.inventory, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `scope3-inventory.json`
    a.click()
  }

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  const inputStyle = {
    padding: '10px 12px',
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    outline: 'none',
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
          GHG Protocol Scope 3 Standard
        </p>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Scope 3 inventory
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          All fifteen categories with tier breakdown and coverage analysis.
        </p>
      </div>

      {/* Selectors */}
      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3], marginBottom: spacing[4], display: 'flex', gap: spacing[3], alignItems: 'flex-end' }}>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Period start</label>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Period end</label>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={inputStyle} />
        </div>
        <button
          onClick={generate}
          disabled={loading}
          style={{ padding: '10px 24px', fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: loading ? colours.textTertiary : colours.navy, border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: typography.tracking.wide }}
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, marginBottom: spacing[3] }}>{error}</p>}

      {result && (
        <>
          {/* Summary + download */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] }}>
            <div>
              <p style={sectionLabel}>Total Scope 3 emissions</p>
              <p style={{ fontSize: '36px', fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
                {(result.inventory.totalKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t CO₂e
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
                From {result.recordCount} records · {result.inventory.categories.length} categories covered
              </p>
            </div>
            <button onClick={downloadJson} style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Download JSON
            </button>
          </div>

          {/* Coverage report */}
          <section style={{ marginBottom: spacing[4] }}>
            <p style={sectionLabel}>Coverage</p>
            <div style={{ display: 'flex', gap: spacing[2] }}>
              {(['fullyDataComplete', 'partiallyEstimated', 'notCovered'] as const).map(key => (
                <div key={key} style={{ flex: 1, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
                  <p style={{ ...sectionLabel, margin: `0 0 ${spacing[1]}` }}>{COVERAGE_LABELS[key]}</p>
                  {result.inventory.coverageReport[key].length === 0 ? (
                    <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>None</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '4px' }}>
                      {result.inventory.coverageReport[key].map(cat => (
                        <span key={cat} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, backgroundColor: colours.background, border: `1px solid ${colours.border}`, borderRadius: '4px', padding: '2px 8px' }}>
                          Cat {cat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Category table */}
          <section>
            <p style={sectionLabel}>By category</p>
            {result.inventory.categories.length === 0 ? (
              <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
                <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                  No Scope 3 records found for this period.
                </p>
              </div>
            ) : (
              <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: colours.background, borderBottom: `1px solid ${colours.border}` }}>
                      {['Cat', 'Name', 'Total CO₂e', 'Verified', 'Declared', 'Estimated', 'Status'].map(col => (
                        <th key={col} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.inventory.categories.map((cat, i) => (
                      <tr key={cat.category} style={{ borderBottom: i < result.inventory.categories.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                        <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>{cat.category}</td>
                        <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>{cat.name}</td>
                        <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                          {(cat.totalKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 })} t
                        </td>
                        {(['A', 'B', 'C'] as const).map(tier => (
                          <td key={tier} style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: TIER_COLOURS[tier], fontVariantNumeric: 'tabular-nums' }}>
                            {(cat.byTier[tier] / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 })}
                          </td>
                        ))}
                        <td style={{ padding: '12px 16px' }}>
                          {cat.isMixedMethod ? (
                            <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.amber }}>Mixed</span>
                          ) : cat.dataComplete ? (
                            <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.green }}>Complete</span>
                          ) : (
                            <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary }}>Estimated</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
