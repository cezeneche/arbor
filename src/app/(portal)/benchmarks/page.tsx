'use client'

import { useEffect, useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import type { BenchmarkPoint } from '@/app/api/benchmarks/route'

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

interface BenchmarkResponse {
  benchmarks: BenchmarkPoint[]
  floor: number
  optedInEntities: number
  availableSectors: string[]
  availableDomains: string[]
}

function RangeBar({ min, q1, median, q3, max }: { min: number; q1: number; median: number; q3: number; max: number }) {
  const range = max - min || 1
  const toPos = (v: number) => `${Math.round(((v - min) / range) * 100)}%`

  return (
    <div style={{ position: 'relative', height: '24px', display: 'flex', alignItems: 'center' }}>
      {/* Full range line */}
      <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', backgroundColor: colours.border }} />
      {/* IQR bar */}
      <div style={{
        position: 'absolute',
        left: toPos(q1),
        width: `${Math.round(((q3 - q1) / range) * 100)}%`,
        height: '8px',
        backgroundColor: colours.navy,
        opacity: 0.25,
        borderRadius: '2px',
      }} />
      {/* Median tick */}
      <div style={{
        position: 'absolute',
        left: toPos(median),
        transform: 'translateX(-50%)',
        width: '3px',
        height: '16px',
        backgroundColor: colours.navy,
        borderRadius: '1px',
      }} />
    </div>
  )
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

export default function BenchmarksPage() {
  const [data, setData] = useState<BenchmarkResponse | null>(null)
  const [sector, setSector] = useState('')
  const [domain, setDomain] = useState('')

  const loading = data === null

  useEffect(() => {
    const params = new URLSearchParams()
    if (sector) params.set('sector', sector)
    if (domain) params.set('domain', domain)
    let cancelled = false
    fetch(`/api/benchmarks?${params.toString()}`)
      .then(r => r.json())
      .then((d: BenchmarkResponse) => { if (!cancelled) setData(d) })
    return () => { cancelled = true }
  }, [sector, domain])

  const handleSectorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSector(e.target.value)
    setData(null)
  }

  const handleDomainChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDomain(e.target.value)
    setData(null)
  }

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  // Group benchmarks by domain
  const grouped: Record<string, BenchmarkPoint[]> = {}
  for (const b of data?.benchmarks ?? []) {
    if (!grouped[b.domain]) grouped[b.domain] = []
    grouped[b.domain].push(b)
  }

  const selectStyle: React.CSSProperties = {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    padding: '6px 10px',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Sector benchmarks
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Anonymised operational data distributions from verified records across participating businesses.
          Individual companies are never identifiable. Requires at least {data?.floor ?? 10} companies per benchmark.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[4], flexWrap: 'wrap' }}>
        <select value={sector} onChange={handleSectorChange} style={selectStyle}>
          <option value="">All sectors</option>
          {(data?.availableSectors ?? []).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={domain} onChange={handleDomainChange} style={selectStyle}>
          <option value="">All data types</option>
          {(data?.availableDomains ?? []).map(d => (
            <option key={d} value={d}>{DOMAIN_LABELS[d] ?? d}</option>
          ))}
        </select>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 'auto 0', alignSelf: 'center' }}>
          {data ? `${data.optedInEntities} businesses contributing` : ''}
        </p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: spacing[5] }}>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
            Loading benchmarks…
          </p>
        </div>
      )}

      {!loading && data && data.benchmarks.length === 0 && (
        <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[1]}`, letterSpacing: typography.tracking.tight }}>
            No benchmarks available yet
          </p>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0, lineHeight: '1.6' }}>
            Benchmarks appear once at least {data.floor} businesses in the same sector have submitted
            verified records for the same field. Currently {data.optedInEntities} {data.optedInEntities === 1 ? 'business has' : 'businesses have'} opted in to data sharing.
            Enable data sharing in Settings to contribute to sector benchmarks.
          </p>
        </div>
      )}

      {!loading && Object.keys(grouped).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[4] }}>
          {Object.entries(grouped).map(([dom, points]) => (
            <section key={dom}>
              <p style={sectionLabel}>{DOMAIN_LABELS[dom] ?? dom}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {points.map((b, i) => (
                  <div key={i} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[2] }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                          {b.fieldName.replace(/_/g, ' ')}
                        </p>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '2px 0 0' }}>
                          {b.sector} · {b.year} · {b.entityCount} businesses · {b.unit}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.navy, margin: 0, letterSpacing: typography.tracking.tight }}>
                          {formatNum(b.median)}
                        </p>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>median</p>
                      </div>
                    </div>

                    <RangeBar min={b.min} q1={b.q1} median={b.median} q3={b.q3} max={b.max} />

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                        Min {formatNum(b.min)}
                      </span>
                      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                        Q1 {formatNum(b.q1)} · Q3 {formatNum(b.q3)}
                      </span>
                      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                        Max {formatNum(b.max)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div style={{ marginTop: spacing[5], padding: spacing[3], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px' }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0, lineHeight: '1.6' }}>
          Benchmarks show statistical distributions of verified operational data from businesses that have opted in to anonymous data sharing.
          No individual business is identifiable in any benchmark. Minimum {data?.floor ?? 10} businesses required per data point.
          To contribute your data and unlock benchmarks for your sector, enable data sharing in{' '}
          <a href="/settings/api-keys" style={{ color: colours.navy, textDecoration: 'none' }}>Settings</a>.
        </p>
      </div>
    </div>
  )
}
