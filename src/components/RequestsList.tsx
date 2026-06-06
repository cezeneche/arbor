'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

export interface DataRequest {
  id: string
  domain: string
  periodStart: string
  periodEnd: string
  requiredFields: string[]
  deadline: string | null
  status: string
  notes: string | null
  createdAt: string
  respondedAt: string | null
  buyerEntity: { legalName: string }
  supplierEntity: { legalName: string }
  buyerEntityId: string
  supplierEntityId: string
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  ACCEPTED: 'Accepted',
  QUERY_RAISED: 'Query raised',
  CLOSED: 'Closed',
}

const STATUS_COLOURS: Record<string, string> = {
  PENDING: colours.amber,
  SUBMITTED: colours.navy,
  ACCEPTED: colours.green,
  QUERY_RAISED: colours.amber,
  CLOSED: colours.textTertiary,
}

const DOMAIN_LABELS: Record<string, string> = {
  ENERGY: 'Energy', MATERIALS: 'Materials', PRODUCTION: 'Production',
  LOGISTICS: 'Logistics', EMISSIONS: 'Emissions', AGRICULTURE: 'Agriculture',
  WASTE_AND_WATER: 'Waste & Water', COMPLIANCE: 'Compliance',
}

interface Props {
  incoming: DataRequest[]
  outgoing: DataRequest[]
}

export function RequestsList({ incoming, outgoing }: Props) {
  const [requests, setRequests] = useState<DataRequest[]>([...incoming, ...outgoing])
  const [respondingTo, setRespondingTo] = useState<string | null>(null)
  const [respondNote, setRespondNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatingLink, setGeneratingLink] = useState<string | null>(null)
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({})

  const currentIncoming = requests.filter(r => incoming.some(i => i.id === r.id))
  const currentOutgoing = requests.filter(r => outgoing.some(o => o.id === r.id))

  async function handleGenerateLink(requestId: string) {
    setGeneratingLink(requestId)
    const res = await fetch(`/api/requests/${requestId}/token`, { method: 'POST' })
    const data = await res.json()
    setGeneratingLink(null)
    if (res.ok && data.link) {
      setGeneratedLinks(prev => ({ ...prev, [requestId]: data.link }))
    } else {
      setError(data.error ?? 'Failed to generate link.')
    }
  }

  async function handleRespond(requestId: string) {
    setError(null)
    setSubmitting(true)

    const res = await fetch(`/api/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SUBMITTED', notes: respondNote }),
    })

    const data = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      setError(data.error ?? 'Failed to update request.')
      return
    }

    setRequests(prev =>
      prev.map(r =>
        r.id === requestId ? { ...r, status: 'SUBMITTED', notes: respondNote } : r
      )
    )
    setRespondingTo(null)
    setRespondNote('')
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
    <div>
      {error && (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.red,
            backgroundColor: colours.redBg,
            padding: '10px 12px',
            borderRadius: '4px',
            marginBottom: spacing[3],
          }}
        >
          {error}
        </p>
      )}

      <section style={{ marginBottom: spacing[5] }}>
        <p style={sectionLabel}>Incoming requests from buyers</p>
        {currentIncoming.length === 0 ? (
          <div
            style={{
              padding: spacing[4],
              textAlign: 'center',
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              color: colours.textSecondary,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
            }}
          >
            No incoming data requests
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {currentIncoming.map(req => (
              <div
                key={req.id}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${req.status === 'PENDING' ? colours.amber : colours.border}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: spacing[3] }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[2] }}>
                    <div>
                      <p
                        style={{
                          fontSize: typography.sizes.base,
                          fontWeight: typography.weights.medium,
                          color: colours.textPrimary,
                          margin: 0,
                        }}
                      >
                        {req.buyerEntity.legalName}
                      </p>
                      <p
                        style={{
                          fontSize: typography.sizes.sm,
                          fontWeight: typography.weights.light,
                          color: colours.textSecondary,
                          margin: `4px 0 0`,
                        }}
                      >
                        {DOMAIN_LABELS[req.domain] ?? req.domain}
                        {' · '}
                        {new Date(req.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        {' – '}
                        {new Date(req.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        {req.deadline && (
                          <span style={{ color: colours.amber }}>
                            {' · Due '}
                            {new Date(req.deadline).toLocaleDateString('en-GB')}
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: STATUS_COLOURS[req.status] ?? colours.textTertiary,
                        textTransform: 'uppercase',
                        letterSpacing: typography.tracking.wide,
                      }}
                    >
                      {STATUS_LABELS[req.status] ?? req.status}
                    </span>
                  </div>

                  <div style={{ marginBottom: spacing[2] }}>
                    <p
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: colours.textTertiary,
                        letterSpacing: typography.tracking.wider,
                        textTransform: 'uppercase',
                        margin: `0 0 6px`,
                      }}
                    >
                      Required fields
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {(req.requiredFields as string[]).map(f => (
                        <span
                          key={f}
                          style={{
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.textSecondary,
                            backgroundColor: colours.background,
                            border: `1px solid ${colours.border}`,
                            borderRadius: '3px',
                            padding: '2px 8px',
                          }}
                        >
                          {f.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>

                  {req.notes && (
                    <p
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        margin: `0 0 ${spacing[2]}`,
                        fontStyle: 'italic',
                      }}
                    >
                      Note: {req.notes}
                    </p>
                  )}

                  {req.status === 'PENDING' && respondingTo !== req.id && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setRespondingTo(req.id)}
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
                        Respond
                      </button>
                    </div>
                  )}
                </div>

                {respondingTo === req.id && (
                  <div
                    style={{
                      borderTop: `1px solid ${colours.border}`,
                      padding: spacing[3],
                      backgroundColor: colours.background,
                    }}
                  >
                    <p
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        color: colours.textPrimary,
                        margin: `0 0 ${spacing[2]}`,
                      }}
                    >
                      Upload the requested data at{' '}
                      <a href="/upload" style={{ color: colours.navy }}>Upload documents</a>
                      , then confirm the request below.
                    </p>

                    <label
                      htmlFor={`note-${req.id}`}
                      style={{
                        display: 'block',
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: colours.textSecondary,
                        letterSpacing: typography.tracking.wider,
                        textTransform: 'uppercase',
                        marginBottom: '6px',
                      }}
                    >
                      Note to buyer (optional)
                    </label>
                    <textarea
                      id={`note-${req.id}`}
                      value={respondNote}
                      onChange={e => setRespondNote(e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textPrimary,
                        backgroundColor: colours.surface,
                        border: `1px solid ${colours.border}`,
                        borderRadius: '4px',
                        outline: 'none',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        marginBottom: spacing[2],
                      }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing[2] }}>
                      <button
                        onClick={() => { setRespondingTo(null); setRespondNote('') }}
                        style={{
                          padding: '10px 16px',
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
                        onClick={() => handleRespond(req.id)}
                        disabled={submitting}
                        style={{
                          padding: '10px 20px',
                          backgroundColor: submitting ? colours.navyHover : colours.navy,
                          color: colours.surface,
                          fontSize: typography.sizes.sm,
                          fontWeight: typography.weights.medium,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: submitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {submitting ? 'Submitting…' : 'Mark as submitted'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {currentOutgoing.length > 0 && (
        <section>
          <p style={sectionLabel}>Sent requests</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentOutgoing.map(req => (
              <div
                key={req.id}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '6px',
                  padding: spacing[2],
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                      margin: 0,
                    }}
                  >
                    {req.supplierEntity.legalName}
                  </p>
                  <p
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      margin: '2px 0 0',
                    }}
                  >
                    {DOMAIN_LABELS[req.domain] ?? req.domain}
                    {' · '}
                    {new Date(req.createdAt).toLocaleDateString('en-GB')}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                  {req.status === 'PENDING' && (
                    generatedLinks[req.id] ? (
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, margin: '0 0 4px', letterSpacing: typography.tracking.wider, textTransform: 'uppercase' }}>
                          Submission link
                        </p>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            readOnly
                            value={generatedLinks[req.id]}
                            style={{
                              fontSize: typography.sizes.xs,
                              fontWeight: typography.weights.light,
                              color: colours.textSecondary,
                              border: `1px solid ${colours.border}`,
                              borderRadius: '3px',
                              padding: '4px 8px',
                              width: '220px',
                              backgroundColor: colours.background,
                            }}
                          />
                          <button
                            onClick={() => navigator.clipboard.writeText(generatedLinks[req.id])}
                            style={{
                              fontSize: typography.sizes.xs,
                              fontWeight: typography.weights.medium,
                              color: colours.navy,
                              backgroundColor: 'transparent',
                              border: `1px solid ${colours.border}`,
                              borderRadius: '3px',
                              padding: '4px 8px',
                              cursor: 'pointer',
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleGenerateLink(req.id)}
                        disabled={generatingLink === req.id}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: colours.navy,
                          fontSize: typography.sizes.xs,
                          fontWeight: typography.weights.medium,
                          border: `1px solid ${colours.border}`,
                          borderRadius: '4px',
                          cursor: generatingLink === req.id ? 'not-allowed' : 'pointer',
                          letterSpacing: typography.tracking.wide,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {generatingLink === req.id ? 'Generating…' : 'Send link'}
                      </button>
                    )
                  )}
                  <span
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: STATUS_COLOURS[req.status] ?? colours.textTertiary,
                      textTransform: 'uppercase',
                      letterSpacing: typography.tracking.wide,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {STATUS_LABELS[req.status] ?? req.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
