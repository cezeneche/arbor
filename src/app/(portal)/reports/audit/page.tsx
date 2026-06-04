'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

interface AuditPackageResult {
  generatedAt: string
  entityId: string
  periodStart: string | null
  periodEnd: string | null
  recordCount: number
  records: Array<{
    id: string
    domain: string
    fieldName: string
    value: number
    unit: string
    trustTier: string
    periodStart: string
    periodEnd: string
    sourceText: string | null
    document: { fileName: string; documentType: string } | null
  }>
  auditChain: { entryCount: number; chainIntegrityVerified: boolean }
  crossValidations: Array<{ passed: boolean }>
}

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

export default function AuditPackagePage() {
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [result, setResult] = useState<AuditPackageResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)

    const params = new URLSearchParams()
    if (periodStart) params.set('periodStart', new Date(periodStart).toISOString())
    if (periodEnd) params.set('periodEnd', new Date(periodEnd).toISOString())

    // entityId comes from the session — the server filters by it
    const res = await fetch(`/api/audit-package/me?${params}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Could not generate audit package.'); setLoading(false); return }
    setResult(data)
    setLoading(false)
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-package-${result.generatedAt.slice(0, 10)}.json`
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
          Third-party verification
        </p>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Audit package
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Structured package for Bureau Veritas, SGS, Lloyd's Register, or any accredited verifier.
          Contains all data records, source documents, cross-validation results, and audit chain.
        </p>
      </div>

      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3], marginBottom: spacing[4], display: 'flex', gap: spacing[3], alignItems: 'flex-end' }}>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Period start <span style={{ fontWeight: typography.weights.light, textTransform: 'none', letterSpacing: 0, color: colours.textTertiary }}>(optional)</span></label>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={{ padding: '10px 12px', fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textPrimary, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '4px', outline: 'none' }} />
        </div>
        <div>
          <label style={{ ...sectionLabel, display: 'block', margin: `0 0 6px` }}>Period end <span style={{ fontWeight: typography.weights.light, textTransform: 'none', letterSpacing: 0, color: colours.textTertiary }}>(optional)</span></label>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={{ padding: '10px 12px', fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textPrimary, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '4px', outline: 'none' }} />
        </div>
        <button
          onClick={generate}
          disabled={loading}
          style={{ padding: '10px 24px', fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: loading ? colours.textTertiary : colours.navy, border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: typography.tracking.wide }}
        >
          {loading ? 'Generating…' : 'Generate package'}
        </button>
      </div>

      {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, marginBottom: spacing[3] }}>{error}</p>}

      {result && (
        <>
          {/* Summary */}
          <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[4] }}>
            {[
              { label: 'Records', value: String(result.recordCount) },
              { label: 'Chain integrity', value: result.auditChain.chainIntegrityVerified ? 'Verified' : 'BROKEN', colour: result.auditChain.chainIntegrityVerified ? colours.green : colours.red },
              { label: 'Cross-validations', value: `${result.crossValidations.filter(c => c.passed).length} / ${result.crossValidations.length} passed` },
              { label: 'Generated', value: new Date(result.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
            ].map(stat => (
              <div key={stat.label} style={{ flex: 1, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
                <p style={sectionLabel}>{stat.label}</p>
                <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: stat.colour ?? colours.textPrimary, margin: 0 }}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: spacing[4] }}>
            <button onClick={downloadJson} style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Download audit package (JSON)
            </button>
          </div>

          {/* Records */}
          <section>
            <p style={sectionLabel}>Records in package</p>
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: colours.background, borderBottom: `1px solid ${colours.border}` }}>
                    {['Domain', 'Field', 'Value', 'Period', 'Trust tier', 'Source'].map(col => (
                      <th key={col} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((r, i) => (
                    <tr key={r.id} style={{ borderBottom: i < result.records.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>{DOMAIN_LABELS[r.domain] ?? r.domain}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>{r.fieldName.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{r.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {r.unit}</td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' as const }}>
                        {new Date(r.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        {' – '}
                        {new Date(r.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px 16px' }}><TierBadge tier={r.trustTier as 'A' | 'B' | 'C'} /></td>
                      <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {r.document?.fileName ?? 'Manual entry'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
