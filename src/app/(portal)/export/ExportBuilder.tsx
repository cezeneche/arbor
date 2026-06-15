'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

const DOMAINS = [
  { value: 'ENERGY', label: 'Energy' },
  { value: 'MATERIALS', label: 'Materials' },
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'EMISSIONS', label: 'Emissions' },
  { value: 'AGRICULTURE', label: 'Agriculture' },
  { value: 'WASTE_AND_WATER', label: 'Waste & Water' },
  { value: 'COMPLIANCE', label: 'Compliance' },
]

const TIER_LABELS: Record<string, string> = { A: 'Verified', B: 'Declared', C: 'Estimated' }
const TIER_COLOURS: Record<string, string> = { A: '#2A6048', B: '#8A3C0A', C: '#9ca3af' }

interface Supplier { id: string; name: string }

interface ExportRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: string
  confidenceScore: number
  periodStart: string
  periodEnd: string
  entityId: string
  supplierName?: string
}

export function ExportBuilder({
  suppliers,
}: {
  suppliers: Supplier[]
  buyerEntityId?: string
}) {
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([])
  const [domain, setDomain] = useState('')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [records, setRecords] = useState<ExportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [previewed, setPreviewed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleSupplier(id: string) {
    setSelectedSuppliers(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
    setPreviewed(false)
  }

  async function handlePreview() {
    setLoading(true)
    setError(null)
    setPreviewed(false)
    setRecords([])

    const targets = selectedSuppliers.length > 0 ? selectedSuppliers : suppliers.map(s => s.id)

    try {
      const results = await Promise.all(
        targets.map(async supplierId => {
          const params = new URLSearchParams()
          params.set('type', 'supply_chain')
          params.set('supplierEntityId', supplierId)
          if (domain) params.set('domain', domain)
          if (periodFrom) params.set('periodStart', new Date(periodFrom).toISOString())
          if (periodTo) params.set('periodEnd', new Date(periodTo).toISOString())
          const res = await fetch(`/api/query?${params.toString()}`)
          if (!res.ok) return []
          const data = await res.json()
          const supplier = suppliers.find(s => s.id === supplierId)
          return (data.records ?? []).map((r: ExportRecord) => ({ ...r, supplierName: supplier?.name ?? supplierId }))
        })
      )
      setRecords(results.flat())
      setPreviewed(true)
    } catch {
      setError('Failed to load records. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  function buildDownloadUrl(format: 'csv' | 'xml'): string {
    // Download uses the authenticated session via cookie  -  direct to query API
    const params = new URLSearchParams()
    params.set('format', format)
    if (domain) params.set('domain', domain)
    if (periodFrom) params.set('periodStart', new Date(periodFrom).toISOString())
    if (periodTo) params.set('periodTo', new Date(periodTo).toISOString())
    if (selectedSuppliers.length > 0) params.set('supplierEntityIds', selectedSuppliers.join(','))
    return `/api/query/export?${params.toString()}`
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    display: 'block',
    marginBottom: '4px',
  }

  return (
    <div>
      {/* Filters panel */}
      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[3],
          marginBottom: spacing[3],
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: spacing[2], marginBottom: spacing[3] }}>
          <div>
            <label style={labelStyle}>Data type</label>
            <select
              value={domain}
              onChange={e => { setDomain(e.target.value); setPreviewed(false) }}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">All data types</option>
              {DOMAINS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Period from</label>
            <input
              type="date"
              value={periodFrom}
              onChange={e => { setPeriodFrom(e.target.value); setPreviewed(false) }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Period to</label>
            <input
              type="date"
              value={periodTo}
              onChange={e => { setPeriodTo(e.target.value); setPreviewed(false) }}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Supplier selector */}
        {suppliers.length > 0 && (
          <div style={{ marginBottom: spacing[3] }}>
            <label style={labelStyle}>Suppliers</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
              {suppliers.map(s => {
                const selected = selectedSuppliers.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleSupplier(s.id)}
                    style={{
                      padding: '5px 12px',
                      fontSize: typography.sizes.sm,
                      fontWeight: selected ? typography.weights.medium : typography.weights.light,
                      color: selected ? colours.navy : colours.textSecondary,
                      backgroundColor: selected ? colours.background : 'transparent',
                      border: `1px solid ${selected ? colours.navy : colours.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>
            {selectedSuppliers.length === 0 && (
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                No selection = all authorised suppliers
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handlePreview}
            disabled={loading}
            style={{
              padding: '10px 24px',
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: loading ? colours.navyHover : colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Loading…' : 'Preview records'}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red, backgroundColor: colours.redBg, padding: '10px 12px', borderRadius: '4px', marginBottom: spacing[2] }}>
          {error}
        </p>
      )}

      {/* Preview table */}
      {previewed && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] }}>
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0 }}>
              {records.length} record{records.length !== 1 ? 's' : ''} matched
            </p>
            {records.length > 0 && (
              <div style={{ display: 'flex', gap: spacing[1] }}>
                <a
                  href={buildDownloadUrl('csv')}
                  download
                  style={{
                    padding: '8px 16px',
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    backgroundColor: colours.surface,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '4px',
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  Download CSV
                </a>
                <a
                  href={buildDownloadUrl('xml')}
                  download
                  style={{
                    padding: '8px 16px',
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    backgroundColor: colours.surface,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '4px',
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  Download XML
                </a>
              </div>
            )}
          </div>

          {records.length === 0 ? (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[4], textAlign: 'center' }}>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                No records match these filters.
              </p>
            </div>
          ) : (
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                    {['Supplier', 'Field', 'Value', 'Period', 'Trust tier', 'Confidence'].map(col => (
                      <th
                        key={col}
                        style={{
                          padding: '10px 16px',
                          fontSize: typography.sizes.xs,
                          fontWeight: typography.weights.medium,
                          color: colours.textSecondary,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={r.id} style={{ borderBottom: i < records.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                      <td style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' }}>
                        {r.supplierName ?? r.entityId.slice(0, 8)}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                        {r.fieldName.replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {r.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {r.unit}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' }}>
                        {new Date(r.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        {' – '}
                        {new Date(r.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: TIER_COLOURS[r.trustTier] ?? colours.textTertiary }}>
                          {TIER_LABELS[r.trustTier] ?? r.trustTier}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                        {Math.round(r.confidenceScore * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {records.length > 0 && (
            <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: `${spacing[2]} 0 0` }}>
              Every exported record includes its trust tier, source reference, and confidence score. These cannot be removed.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
