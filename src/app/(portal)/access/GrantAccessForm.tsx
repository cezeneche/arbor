'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

interface Buyer {
  id: string
  legalName: string
}

const DOMAINS = [
  { value: 'ENERGY', label: 'Energy' },
  { value: 'MATERIALS', label: 'Materials' },
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'EMISSIONS', label: 'Emissions' },
  { value: 'AGRICULTURE', label: 'Agriculture' },
  { value: 'WASTE_AND_WATER', label: 'Waste and water' },
  { value: 'COMPLIANCE', label: 'Compliance' },
]

export function GrantAccessForm({ knownBuyers }: { knownBuyers: Buyer[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [buyerEntityId, setBuyerEntityId] = useState(knownBuyers[0]?.id ?? '')
  const [customBuyerId, setCustomBuyerId] = useState('')
  const [domain, setDomain] = useState('ENERGY')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveBuyerId = customBuyerId.trim() || buyerEntityId
  const selectedBuyerName = knownBuyers.find((b) => b.id === effectiveBuyerId)?.legalName ?? 'this buyer'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!effectiveBuyerId) { setError('Please select or enter a buyer.'); return }
    if (!periodStart || !periodEnd) { setError('Please enter the period.'); return }
    if (new Date(periodEnd) <= new Date(periodStart)) { setError('Period end must be after period start.'); return }
    if (!consent) { setError('Please confirm the consent acknowledgement.'); return }

    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        granteeEntityId: effectiveBuyerId,
        domain,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
        consent,
      }),
    })

    const data = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.')
      return
    }

    setOpen(false)
    setCustomBuyerId('')
    setPeriodStart('')
    setPeriodEnd('')
    setConsent(false)
    router.refresh()
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
    color: colours.textPrimary,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    display: 'block',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    marginBottom: '6px',
  }

  if (!open) {
    return (
      <div style={{ marginBottom: spacing[4] }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: '10px 20px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            letterSpacing: typography.tracking.wide,
          }}
        >
          Share data with a buyer
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
        padding: spacing[3],
        marginBottom: spacing[4],
      }}
    >
      <p
        style={{
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.medium,
          color: colours.textPrimary,
          margin: `0 0 ${spacing[3]}`,
        }}
      >
        Share data with a buyer
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={labelStyle}>Buyer</label>
            {knownBuyers.length > 0 && (
              <select
                value={customBuyerId ? '' : buyerEntityId}
                onChange={e => { setBuyerEntityId(e.target.value); setCustomBuyerId('') }}
                style={{ ...inputStyle, marginBottom: '8px' }}
              >
                {knownBuyers.map(b => (
                  <option key={b.id} value={b.id}>{b.legalName}</option>
                ))}
                <option value="">Other: enter buyer ID below</option>
              </select>
            )}
            {(knownBuyers.length === 0 || !buyerEntityId || customBuyerId !== '') && (
              <input
                type="text"
                placeholder="Buyer entity ID (provided by the buyer)"
                value={customBuyerId}
                onChange={e => setCustomBuyerId(e.target.value)}
                style={inputStyle}
              />
            )}
            <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
              The buyer&apos;s system ID. They can find it in their account settings.
            </p>
          </div>

          <div>
            <label style={labelStyle}>Data type</label>
            <select
              value={domain}
              onChange={e => setDomain(e.target.value)}
              style={inputStyle}
            >
              {DOMAINS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period from</label>
              <input
                type="date"
                required
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period to</label>
              <input
                type="date"
                required
                value={periodEnd}
                onChange={e => setPeriodEnd(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            gap: spacing[1],
            alignItems: 'flex-start',
            marginTop: spacing[3],
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            lineHeight: 1.5,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ marginTop: '3px' }}
          />
          <span>
            I understand that {selectedBuyerName} may use this data for their own reporting.
            Sharing this data does not transfer my liability for its accuracy.
          </span>
        </label>

        {error && (
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red, margin: `${spacing[2]} 0 0` }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: spacing[3] }}>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null) }}
            style={{
              padding: '10px 20px',
              backgroundColor: 'transparent',
              color: colours.textSecondary,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '10px 20px',
              backgroundColor: submitting ? colours.textTertiary : colours.navy,
              color: colours.surface,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              border: 'none',
              borderRadius: '4px',
              cursor: submitting ? 'not-allowed' : 'pointer',
              letterSpacing: typography.tracking.wide,
            }}
          >
            {submitting ? 'Saving…' : 'Grant access'}
          </button>
        </div>
      </form>
    </div>
  )
}
