'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

const currentYear = new Date().getFullYear()
const YEARS = [currentYear - 2, currentYear - 1, currentYear]

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

interface DataPoint {
  recordId: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
  isEstimated: boolean
  scope3Category: number | null
  periodStart: string
  periodEnd: string
}

interface CsrdResult {
  disclosure: {
    entityName: string
    reportingYear: number
    standard: string
    regulatoryReference: string
    dataPoints: DataPoint[]
  }
  recordCount: number
}

export default function CsrdReportPage() {
  const [year, setYear] = useState(currentYear - 1)
  const [result, setResult] = useState<CsrdResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    const res = await fetch(`/api/reports/csrd?year=${year}`)
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
    a.download = `csrd-esrs-e1-${year}.json`
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
    <div style={{ maxWidth: '960px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
          EU 2023/2772 · ESRS E1
        </p>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          CSRD / ESRS E1 disclosure
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Climate change disclosures aligned to European Sustainability Reporting Standard E1.
        </p>
      </div>

      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3], marginBottom: spacing[4], display: 'flex', gap: spacing[3], alignItems: 'flex-end' }}>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Reporting year</label>
          <select
            value={year}
            onChange={e => setYear(parseInt(e.target.value, 10))}
            style={{ padding: '10px 12px', fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textPrimary, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '4px', outline: 'none' }}
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] }}>
            <div>
              <p style={sectionLabel}>Summary</p>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                {result.disclosure.dataPoints.length} data points · {result.disclosure.dataPoints.filter(d => d.isEstimated).length} estimated
              </p>
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                {result.disclosure.regulatoryReference}
              </p>
            </div>
            <button onClick={downloadJson} style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Download JSON
            </button>
          </div>

          {result.disclosure.dataPoints.length === 0 ? (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                No records found for reporting year {year}.
              </p>
            </div>
          ) : (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: colours.background, borderBottom: `1px solid ${colours.border}` }}>
                    {['Domain', 'Field', 'Value', 'Cat 3', 'Period', 'Trust tier'].map(col => (
                      <th key={col} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.disclosure.dataPoints.map((dp, i) => (
                    <tr key={dp.recordId} style={{ borderBottom: i < result.disclosure.dataPoints.length - 1 ? `1px solid ${colours.border}` : 'none', backgroundColor: dp.isEstimated ? colours.background : 'transparent' }}>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>{DOMAIN_LABELS[dp.domain] ?? dp.domain}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>{dp.fieldName.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{dp.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {dp.unit}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>{dp.scope3Category ?? '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' as const }}>
                        {new Date(dp.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        {' – '}
                        {new Date(dp.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px 16px' }}><TierBadge tier={dp.trustTier} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
