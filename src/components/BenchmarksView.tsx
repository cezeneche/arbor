'use client'

import { useEffect, useState } from 'react'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import type { BenchmarkPoint } from '@/app/api/benchmarks/route'

interface BenchmarkResponse {
  /** True when this business has not opted in to sharing, so cannot read the pool. */
  locked?: boolean
  lockedReason?: string | null
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

const PAGE_SIZE = 20

function PaginationBar({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const btn: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.navy,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    cursor: 'pointer',
    letterSpacing: typography.tracking.wide,
  }
  const ghost: React.CSSProperties = { ...btn, color: 'transparent', border: '1px solid transparent', cursor: 'default' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing[3] }}>
      {page > 1
        ? <button style={btn} onClick={() => onPage(page - 1)}>← Previous</button>
        : <span style={ghost}>← Previous</span>}
      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
        Page {page} of {totalPages}
      </span>
      {page < totalPages
        ? <button style={btn} onClick={() => onPage(page + 1)}>Next →</button>
        : <span style={ghost}>Next →</span>}
    </div>
  )
}

// Sector benchmarks, rendered as a view inside Records (no own page heading;
// Records provides the title and the Records · Trends · Benchmarks toggle).
export function BenchmarksView() {
  const [data, setData] = useState<BenchmarkResponse | null>(null)
  const [sector, setSector] = useState('')
  const [domain, setDomain] = useState('')
  const [benchmarkPage, setBenchmarkPage] = useState(1)

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
    setBenchmarkPage(1)
  }

  const handleDomainChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDomain(e.target.value)
    setData(null)
    setBenchmarkPage(1)
  }

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  const allBenchmarks = data?.benchmarks ?? []
  const totalBenchmarkPages = Math.ceil(allBenchmarks.length / PAGE_SIZE)
  const pagedBenchmarks = allBenchmarks.slice((benchmarkPage - 1) * PAGE_SIZE, benchmarkPage * PAGE_SIZE)

  // Group paginated benchmarks by domain
  const grouped: Record<string, BenchmarkPoint[]> = {}
  for (const b of pagedBenchmarks) {
    if (!grouped[b.domain]) grouped[b.domain] = []
    grouped[b.domain].push(b)
  }

  // Benchmarks are reciprocal: contributing is what unlocks reading. Until this
  // business switches sharing on, the whole surface stays closed — with the one
  // sentence that opens it, and the link that does it.
  if (!loading && data?.locked) {
    return (
      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[4],
          maxWidth: '640px',
        }}
      >
        <p style={{ ...textStyles.eyebrow, marginBottom: spacing[1] }}>Locked</p>
        <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>
          Share your data to see how you compare
        </p>
        <p style={{ ...textStyles.sectionSubtitle, lineHeight: typography.lineHeight.body }}>
          {data.lockedReason}
        </p>
        <a
          href="/settings"
          style={{
            display: 'inline-block',
            marginTop: spacing[3],
            padding: '10px 20px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            borderRadius: '4px',
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
          }}
        >
          Turn on data sharing
        </a>
      </div>
    )
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
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[4] }}>
        <p style={textStyles.sectionSubtitle}>
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
          <p style={{ ...textStyles.rowTitle, margin: `0 0 ${spacing[1]}` }}>
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
                        <p style={textStyles.sectionTitle}>
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
          <PaginationBar page={benchmarkPage} totalPages={totalBenchmarkPages} onPage={setBenchmarkPage} />
        </div>
      )}

      <div style={{ marginTop: spacing[5], padding: spacing[3], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px' }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0, lineHeight: '1.6' }}>
          Benchmarks show statistical distributions of verified operational data from businesses that have opted in to anonymous data sharing.
          No individual business is identifiable in any benchmark. Minimum {data?.floor ?? 10} businesses required per data point.
          You can see these figures because you share yours; switching sharing off in{' '}
          <a href="/settings" style={{ color: colours.navy, textDecoration: 'none' }}>Settings</a> removes your records from
          future benchmarks and closes this view again.
        </p>
      </div>
    </div>
  )
}
