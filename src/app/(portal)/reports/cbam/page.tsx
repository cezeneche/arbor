'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const currentYear = new Date().getFullYear()
const YEARS = [currentYear - 1, currentYear, currentYear + 1]

interface Declaration {
  id: string
  declarationReference: string
  commodityCode: string
  commodityDescription: string
  countryOfOrigin: string
  importerName: string
  declaredWeight: number
  embeddedEmissionsKgCo2e: number
  calculationTier: string
  trustTier: 'A' | 'B' | 'C'
  requiresVerification: boolean
}

interface CbamResult {
  ukReturn: {
    entityName: string
    quarter: string
    year: number
    regulatoryReference: string
    totalEmbeddedEmissionsKgCo2e: number
    declarations: Declaration[]
  }
  euXml: string
  documentCount: number
}

export default function CbamReportPage() {
  const [quarter, setQuarter] = useState('Q1')
  const [year, setYear] = useState(currentYear)
  const [result, setResult] = useState<CbamResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    const res = await fetch(`/api/reports/cbam?quarter=${quarter}&year=${year}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Could not generate report.'); setLoading(false); return }
    setResult(data)
    setLoading(false)
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.ukReturn, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cbam-uk-${quarter}-${year}.json`
    a.click()
  }

  function downloadXml() {
    if (!result) return
    const blob = new Blob([result.euXml], { type: 'application/xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cbam-eu-${quarter}-${year}.xml`
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

  const selectStyle = {
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
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            margin: `0 0 ${spacing[1]}`,
          }}
        >
          EU Regulation 2023/1773
        </p>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          CBAM return
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Quarterly embedded emissions return for UK HMRC and EU registry.
        </p>
      </div>

      {/* Selectors */}
      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[3],
          marginBottom: spacing[4],
          display: 'flex',
          gap: spacing[3],
          alignItems: 'flex-end',
        }}
      >
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Quarter</label>
          <select value={quarter} onChange={e => setQuarter(e.target.value)} style={selectStyle}>
            {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Year</label>
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} style={selectStyle}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          style={{
            padding: '10px 24px',
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.surface,
            backgroundColor: loading ? colours.textTertiary : colours.navy,
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            letterSpacing: typography.tracking.wide,
          }}
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && (
        <p style={{ color: colours.red, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, marginBottom: spacing[3] }}>
          {error}
        </p>
      )}

      {result && (
        <>
          {/* Summary */}
          <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[4] }}>
            {[
              { label: 'Declarations', value: String(result.ukReturn.declarations.length) },
              { label: 'Total embedded emissions', value: `${result.ukReturn.totalEmbeddedEmissionsKgCo2e.toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg CO₂e` },
              { label: 'Require verification', value: String(result.ukReturn.declarations.filter(d => d.requiresVerification).length) },
            ].map(stat => (
              <div
                key={stat.label}
                style={{
                  flex: 1,
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '6px',
                  padding: spacing[3],
                }}
              >
                <p style={sectionLabel}>{stat.label}</p>
                <p style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Downloads */}
          <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[4] }}>
            <button onClick={downloadJson} style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Download UK return (JSON)
            </button>
            <button onClick={downloadXml} style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.navy, backgroundColor: colours.surface, border: `1px solid ${colours.navy}`, borderRadius: '4px', cursor: 'pointer' }}>
              Download EU XML
            </button>
          </div>

          {/* Declarations table */}
          {result.ukReturn.declarations.length === 0 ? (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                No accepted CBAM declarations found for {quarter} {year}.
              </p>
            </div>
          ) : (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: colours.background, borderBottom: `1px solid ${colours.border}` }}>
                    {['Reference', 'Commodity', 'Country', 'Weight (kg)', 'Emissions (kg CO₂e)', 'Tier'].map(col => (
                      <th key={col} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.ukReturn.declarations.map((d, i) => (
                    <tr key={d.id} style={{ borderBottom: i < result.ukReturn.declarations.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>{d.declarationReference}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>
                        <div>{d.commodityCode}</div>
                        <div style={{ fontSize: typography.sizes.xs, color: colours.textSecondary }}>{d.commodityDescription}</div>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>{d.countryOfOrigin}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{d.declaredWeight.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{d.embeddedEmissionsKgCo2e.toLocaleString('en-GB', { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: '12px 16px' }}><TierBadge tier={d.trustTier} /></td>
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
