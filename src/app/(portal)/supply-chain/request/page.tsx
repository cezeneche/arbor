'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

const DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

type Domain = typeof DOMAINS[number]

const DOMAIN_FIELDS: Record<Domain, string[]> = {
  ENERGY: ['electricity_consumption_kwh', 'gas_consumption_kwh', 'fuel_consumption_litres', 'renewable_percentage'],
  MATERIALS: ['material_type', 'quantity_kg', 'country_of_origin', 'supplier_name'],
  PRODUCTION: ['product_type', 'quantity_produced', 'production_unit', 'process_stage'],
  LOGISTICS: ['transport_mode', 'distance_km', 'shipment_weight_kg', 'origin', 'destination'],
  EMISSIONS: ['total_co2e_kg', 'scope1_kg', 'scope2_kg', 'emission_factor_source'],
  AGRICULTURE: ['crop_type', 'area_hectares', 'yield_quantity', 'fertiliser_n_kg'],
  WASTE_AND_WATER: ['waste_quantity_kg', 'disposal_method', 'water_consumption_m3', 'water_source'],
  COMPLIANCE: ['cbam_commodity_code', 'embedded_emissions_tco2e', 'calculation_tier'],
}

function RequestForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supplierId = searchParams.get('supplierId') ?? ''

  const [domain, setDomain] = useState<Domain>('ENERGY')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)


  const toggleField = (field: string) => {
    setSelectedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) { setError('No supplier specified.'); return }
    if (selectedFields.length === 0) { setError('Select at least one field.'); return }

    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierEntityId: supplierId,
        domain,
        periodStart,
        periodEnd,
        requiredFields: selectedFields,
        ...(deadline ? { deadline } : {}),
        ...(notes ? { notes } : {}),
      }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Request failed.')
      return
    }

    router.push('/supply-chain')
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    display: 'block',
    marginBottom: '6px',
    letterSpacing: typography.tracking.wide,
  }

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          Request data
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Send a scoped data request to this supplier.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: '640px' }}>
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            padding: spacing[3],
            display: 'flex',
            flexDirection: 'column',
            gap: spacing[3],
          }}
        >
          <div>
            <label style={labelStyle}>Domain</label>
            <select
              value={domain}
              onChange={e => { setDomain(e.target.value as Domain); setSelectedFields([]) }}
              style={inputStyle}
              required
            >
              {DOMAINS.map(d => (
                <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: spacing[2] }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period start</label>
              <input
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period end</label>
              <input
                type="date"
                value={periodEnd}
                onChange={e => setPeriodEnd(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Required fields</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {DOMAIN_FIELDS[domain].map(field => (
                <label
                  key={field}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textPrimary,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(field)}
                    onChange={() => toggleField(field)}
                  />
                  {field.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Deadline (optional)</label>
            <input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Additional context for the supplier..."
            />
          </div>

          {error && (
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.red,
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: spacing[2] }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '12px 24px',
                backgroundColor: submitting ? colours.textTertiary : colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                borderRadius: '4px',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                letterSpacing: typography.tracking.wide,
              }}
            >
              {submitting ? 'Sending…' : 'Send request'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/supply-chain')}
              style={{
                padding: '12px 24px',
                backgroundColor: 'transparent',
                color: colours.textSecondary,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.light,
                borderRadius: '4px',
                border: `1px solid ${colours.border}`,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function RequestPage() {
  return (
    <Suspense>
      <RequestForm />
    </Suspense>
  )
}
