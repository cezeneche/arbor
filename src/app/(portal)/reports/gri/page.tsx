'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

const currentYear = new Date().getFullYear()
const YEARS = [currentYear - 2, currentYear - 1, currentYear]

interface Gri305Result {
  disclosure: {
    standard: string
    regulatoryReference: string
    entityName: string
    reportingYear: number
    gri305_1: { label: string; totalKgCo2e: number; trustTier: 'A' | 'B' | 'C' }
    gri305_2: { label: string; totalKgCo2e: number; trustTier: 'A' | 'B' | 'C' }
    gri305_3: { label: string; totalKgCo2e: number; trustTier: 'A' | 'B' | 'C'; byCategory: Array<{ category: number; name: string; totalKgCo2e: number; trustTier: 'A' | 'B' | 'C' }> }
    gri305_4?: { ratioKgCo2ePerUnit: number; denominatorValue: number; denominatorUnit: string; trustTier: 'A' | 'B' | 'C' }
  }
}

export default function GriReportPage() {
  const [year, setYear] = useState(currentYear - 1)
  const [result, setResult] = useState<Gri305Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    const res = await fetch(`/api/reports/gri?year=${year}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Could not generate report.'); setLoading(false); return }
    setResult(data)
    setLoading(false)
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.disclosure, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gri-305-${year}.json`
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

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
          GRI 305: Emissions 2016
        </p>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          GRI Standards disclosure
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          GRI 305-1 (Scope 1), 305-2 (Scope 2), and 305-3 (Scope 3) emissions from your certified data records.
        </p>
      </div>

      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3], marginBottom: spacing[4], display: 'flex', gap: spacing[3], alignItems: 'flex-end' }}>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Reporting year</label>
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} style={{ padding: '10px 12px', fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textPrimary, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '4px', outline: 'none' }}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={generate} disabled={loading} style={{ padding: '10px 24px', fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: loading ? colours.textTertiary : colours.navy, border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: typography.tracking.wide }}>
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, marginBottom: spacing[3] }}>{error}</p>}

      {result && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] }}>
            <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
              {result.disclosure.regulatoryReference}
            </p>
            <button onClick={downloadJson} style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Download JSON
            </button>
          </div>

          {/* GRI 305-1, 305-2, 305-3 cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
            {[result.disclosure.gri305_1, result.disclosure.gri305_2].map(section => (
              <div key={section.label} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <p style={sectionLabel}>{section.label}</p>
                  <TierBadge tier={section.trustTier} />
                </div>
                <p style={{ fontSize: '28px', fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight, fontVariantNumeric: 'tabular-nums' }}>
                  {(section.totalKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t CO₂e
                </p>
              </div>
            ))}

            {/* GRI 305-3 with category breakdown */}
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[2] }}>
                <p style={{ ...sectionLabel, margin: 0 }}>{result.disclosure.gri305_3.label}</p>
                <TierBadge tier={result.disclosure.gri305_3.trustTier} />
              </div>
              <p style={{ fontSize: '28px', fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[3]}`, letterSpacing: typography.tracking.tight, fontVariantNumeric: 'tabular-nums' }}>
                {(result.disclosure.gri305_3.totalKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t CO₂e
              </p>
              {result.disclosure.gri305_3.byCategory.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {result.disclosure.gri305_3.byCategory.map(cat => (
                    <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${colours.border}` }}>
                      <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                        Cat {cat.category} — {cat.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                          {(cat.totalKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 })} t
                        </span>
                        <TierBadge tier={cat.trustTier} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
