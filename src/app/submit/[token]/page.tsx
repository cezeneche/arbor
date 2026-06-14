'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

interface RequestDetails {
  id: string
  buyerName: string
  domain: string
  periodStart: string
  periodEnd: string
  requiredFields: string[]
  deadline: string | null
  notes: string | null
  status: string
  submissionTokenExpiry: string | null
}

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste and water', COMPLIANCE: 'Compliance',
}

function plainFieldLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function SubmitPage() {
  const { token } = useParams<{ token: string }>()
  const [request, setRequest] = useState<RequestDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [values, setValues] = useState<Record<string, string>>({})
  const [units, setUnits] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`/api/submit/${token}`, { method: 'GET' })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          setError(body.error ?? 'This link is not valid.')
          return
        }
        const data = await r.json()
        setRequest(data)
      })
      .catch(() => setError('Could not load this request. Please check your internet connection.'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!request) return

    const entries = request.requiredFields.map(field => ({
      fieldName: field,
      value: parseFloat(values[field] ?? '0'),
      unit: units[field] ?? '',
    })).filter(e => !isNaN(e.value) && e.unit)

    if (entries.length === 0) {
      setError('Please fill in at least one field with a value and unit.')
      return
    }

    setSubmitting(true)
    setError(null)

    const res = await fetch(`/api/submit/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })

    if (res.ok) {
      setDone(true)
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Something went wrong. Please try again.')
    }

    setSubmitting(false)
  }

  const containerStyle = {
    minHeight: '100vh',
    backgroundColor: colours.background,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '48px 24px',
  }

  const cardStyle = {
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '8px',
    padding: spacing[5],
    width: '100%',
    maxWidth: '560px',
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0 }}>
            Loading your request...
          </p>
        </div>
      </div>
    )
  }

  if (error && !request) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: '0.12em', textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            arbor
          </p>
          <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[1]}`, letterSpacing: '-0.03em' }}>
            This link is not available
          </h1>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0 }}>
            {error}
          </p>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: '0.12em', textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            arbor
          </p>
          <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[1]}`, letterSpacing: '-0.03em' }}>
            Done. Your data has been saved.
          </h1>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[3]}` }}>
            {request?.buyerName} will be able to see the information you entered. It has been recorded as Declared. You can improve its status at any time by uploading a supporting document.
          </p>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
            You can close this window.
          </p>
        </div>
      </div>
    )
  }

  if (!request) return null

  const expiredToken = request.submissionTokenExpiry && new Date(request.submissionTokenExpiry) < new Date()
  const alreadyResponded = request.status === 'SUBMITTED' || request.status === 'ACCEPTED'

  if (expiredToken || alreadyResponded) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: '0.12em', textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            arbor
          </p>
          <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[1]}`, letterSpacing: '-0.03em' }}>
            {alreadyResponded ? 'This request has already been responded to' : 'This link has expired'}
          </h1>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0 }}>
            {alreadyResponded
              ? `You already responded to ${request.buyerName}'s request.`
              : `Please contact ${request.buyerName} to request a new link.`}
          </p>
        </div>
      </div>
    )
  }

  const periodLabel = [
    new Date(request.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
    new Date(request.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
  ].join(' – ')

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: '560px' }}>
        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: '0.12em', textTransform: 'uppercase', margin: `0 0 ${spacing[2]}` }}>
          arbor
        </p>

        <div style={cardStyle}>
          <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[1]}`, letterSpacing: '-0.03em' }}>
            {request.buyerName} needs some data from you
          </h1>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[3]}`, lineHeight: '1.6' }}>
            They need your {DOMAIN_LABELS[request.domain] ?? request.domain} figures for {periodLabel}. Enter the values below. It should take about five minutes.
          </p>

          {request.notes && (
            <div style={{ backgroundColor: colours.background, borderRadius: '6px', padding: spacing[2], marginBottom: spacing[3] }}>
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: '0.12em', textTransform: 'uppercase', margin: `0 0 6px` }}>
                Note from {request.buyerName}
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0, lineHeight: '1.5' }}>
                {request.notes}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: spacing[3] }}>
              {request.requiredFields.map(field => (
                <div key={field}>
                  <label
                    style={{ display: 'block', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, marginBottom: '8px' }}
                  >
                    {plainFieldLabel(field)}
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="0"
                      value={values[field] ?? ''}
                      onChange={e => setValues(v => ({ ...v, [field]: e.target.value }))}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        fontSize: typography.sizes.base,
                        fontWeight: typography.weights.light,
                        border: `1px solid ${colours.border}`,
                        borderRadius: '4px',
                        backgroundColor: colours.surface,
                        color: colours.textPrimary,
                        outline: 'none',
                      }}
                    />
                    <input
                      type="text"
                      required
                      placeholder="unit (e.g. kWh)"
                      value={units[field] ?? ''}
                      onChange={e => setUnits(u => ({ ...u, [field]: e.target.value }))}
                      style={{
                        width: '130px',
                        padding: '10px 12px',
                        fontSize: typography.sizes.base,
                        fontWeight: typography.weights.light,
                        border: `1px solid ${colours.border}`,
                        borderRadius: '4px',
                        backgroundColor: colours.surface,
                        color: colours.textPrimary,
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red, marginBottom: spacing[2] }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                display: 'block',
                width: '100%',
                padding: '14px 24px',
                backgroundColor: submitting ? colours.textTertiary : colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                borderRadius: '4px',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                letterSpacing: '0.08em',
              }}
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>

            <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, textAlign: 'center', margin: `${spacing[2]} 0 0`, lineHeight: '1.5' }}>
              The data you enter will be recorded as Declared. You can improve its status later by uploading a supporting document.
            </p>
          </form>
        </div>

        {request.deadline && (
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, textAlign: 'center', margin: `${spacing[2]} 0 0` }}>
            Deadline: {new Date(request.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>
    </div>
  )
}
