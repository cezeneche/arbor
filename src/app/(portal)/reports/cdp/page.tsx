'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

const currentYear = new Date().getFullYear()
const YEARS = [currentYear - 2, currentYear - 1, currentYear]

const DATA_QUALITY_COLOURS: Record<string, string> = {
  'Third-party verified': colours.green,
  'Reported': colours.amber,
  'Estimated': colours.textTertiary,
}

interface CdpSection {
  trustTier: 'A' | 'B' | 'C'
  dataQuality: string
}

interface C6_1 extends CdpSection { grossScope1KgCo2e: number }
interface C6_3 extends CdpSection { grossScope2LocationBasedKgCo2e: number }
interface C6_5 extends CdpSection {
  totalScope3KgCo2e: number
  categories: Array<{ category: number; name: string; totalKgCo2e: number; dataQuality: string; trustTier: 'A' | 'B' | 'C' }>
}

interface CdpResult {
  disclosure: {
    questionnaire: string
    reportingYear: number
    entityName: string
    regulatoryReference: string
    c6_1: C6_1
    c6_3: C6_3
    c6_5: C6_5
    overallTrustTier: 'A' | 'B' | 'C'
  }
}

export default function CdpReportPage() {
  const [year, setYear] = useState(currentYear - 1)
  const [result, setResult] = useState<CdpResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    const res = await fetch(`/api/reports/cdp?year=${year}`)
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
    a.download = `cdp-climate-${year}.json`
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

  function DataQualityTag({ quality }: { quality: string }) {
    return (
      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: DATA_QUALITY_COLOURS[quality] ?? colours.textTertiary }}>
        {quality}
      </span>
    )
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
          CDP Climate Change · Section C6
        </p>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          CDP Climate disclosure
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Pre-filled C6 emissions data from your certified records. Data quality is shown per section based on trust tier.
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
            {/* C6.1 */}
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[1] }}>
                <p style={{ ...sectionLabel, margin: 0 }}>C6.1 — Gross global Scope 1 emissions</p>
                <DataQualityTag quality={result.disclosure.c6_1.dataQuality} />
              </div>
              <p style={{ fontSize: '28px', fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight, fontVariantNumeric: 'tabular-nums' }}>
                {(result.disclosure.c6_1.grossScope1KgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t CO₂e
              </p>
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                {result.disclosure.c6_1.dataQuality === 'Third-party verified'
                  ? 'Based on verified documents extracted from source records.'
                  : result.disclosure.c6_1.dataQuality === 'Reported'
                  ? 'Based on declared figures without source document backing.'
                  : 'Based on estimated default factors. Upload source documents to improve this figure.'}
              </p>
            </div>

            {/* C6.3 */}
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[1] }}>
                <p style={{ ...sectionLabel, margin: 0 }}>C6.3 — Gross global Scope 2 emissions (location-based)</p>
                <DataQualityTag quality={result.disclosure.c6_3.dataQuality} />
              </div>
              <p style={{ fontSize: '28px', fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight, fontVariantNumeric: 'tabular-nums' }}>
                {(result.disclosure.c6_3.grossScope2LocationBasedKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t CO₂e
              </p>
            </div>

            {/* C6.5 */}
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[2] }}>
                <p style={{ ...sectionLabel, margin: 0 }}>C6.5 — Gross global Scope 3 emissions</p>
                <DataQualityTag quality={result.disclosure.c6_5.dataQuality} />
              </div>
              <p style={{ fontSize: '28px', fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[3]}`, letterSpacing: typography.tracking.tight, fontVariantNumeric: 'tabular-nums' }}>
                {(result.disclosure.c6_5.totalScope3KgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} t CO₂e
              </p>
              {result.disclosure.c6_5.categories.length > 0 && (
                <div>
                  {result.disclosure.c6_5.categories.map(cat => (
                    <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${colours.border}` }}>
                      <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                        Cat {cat.category} — {cat.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                          {(cat.totalKgCo2e / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 })} t
                        </span>
                        <DataQualityTag quality={cat.dataQuality} />
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
