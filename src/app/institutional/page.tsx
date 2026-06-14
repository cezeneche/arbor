'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

const INTEREST_AREAS = [
  { value: 'BENCHMARKS', label: 'Sector benchmark data' },
  { value: 'DATA_PARTNERSHIP', label: 'Data partnership programme' },
  { value: 'POLICY', label: 'Policy or regulatory use' },
  { value: 'OTHER', label: 'Other' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  backgroundColor: colours.surface,
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  marginBottom: '6px',
}

export default function InstitutionalPage() {
  const [form, setForm] = useState({
    orgName: '',
    contactName: '',
    email: '',
    role: '',
    interestArea: '',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/institutional/enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (res.ok) {
      setSubmitted(true)
    } else {
      const data = await res.json().catch(() => ({}))
      setError((data as Record<string, string>).error ?? 'Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: colours.background,
        fontFamily: typography.fontFamily,
      }}
    >
      {/* Header */}
      <header
        style={{
          backgroundColor: colours.navy,
          padding: `${spacing[3]} ${spacing[4]}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.surface,
            letterSpacing: typography.tracking.tight,
          }}
        >
          arbor
        </span>
        <a
          href="/login"
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.surface,
            opacity: 0.7,
            textDecoration: 'none',
          }}
        >
          Sign in
        </a>
      </header>

      <main style={{ maxWidth: '960px', margin: '0 auto', padding: `${spacing[8]} ${spacing[4]}` }}>
        {/* Hero */}
        <div style={{ marginBottom: spacing[8] }}>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              margin: `0 0 ${spacing[2]}`,
            }}
          >
            For governments, regulators, and institutional partners
          </p>
          <h1
            style={{
              fontSize: '36px',
              fontWeight: typography.weights.medium,
              color: colours.navy,
              letterSpacing: typography.tracking.tight,
              margin: `0 0 ${spacing[2]}`,
              lineHeight: 1.15,
            }}
          >
            Verified operational data,<br />ready for policy use
          </h1>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              maxWidth: '640px',
              lineHeight: 1.65,
              margin: 0,
            }}
          >
            arbor is a certified operational data repository. Manufacturers and suppliers upload
            production documents. The platform extracts, certifies, and stores the data. Every
            record carries a trust tier, a confidence score, and a link to the source document
            it came from.
          </p>
        </div>

        {/* Three-column feature grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: spacing[2],
            marginBottom: spacing[8],
          }}
        >
          {[
            {
              title: 'Document-backed records',
              body: 'Every data point is tied to a source document: electricity bills, production logs, freight invoices, certificates. The source text is stored alongside the value so any claim can be traced.',
            },
            {
              title: 'Sector benchmarks',
              body: 'Anonymised sector-level statistics computed live from opted-in supplier data. Minimum population floor of 10 entities per benchmark cell. Available as structured data for regulatory use.',
            },
            {
              title: 'Three-tier certification',
              body: 'Verified (document-extracted, confidence ≥ 85%), Declared (self-reported), or Estimated (published default factor). The tier travels with every record in every export.',
            },
          ].map(card => (
            <div
              key={card.title}
              style={{
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '8px',
                padding: spacing[3],
              }}
            >
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  color: colours.navy,
                  margin: `0 0 ${spacing[1]}`,
                }}
              >
                {card.title}
              </p>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {card.body}
              </p>
            </div>
          ))}
        </div>

        {/* Use cases */}
        <div style={{ marginBottom: spacing[8] }}>
          <h2
            style={{
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.medium,
              color: colours.navy,
              letterSpacing: typography.tracking.tight,
              margin: `0 0 ${spacing[2]}`,
            }}
          >
            How institutions use arbor data
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[2] }}>
            {[
              { label: 'CBAM compliance', text: 'Regulators can cross-reference declared embedded emissions against certified supplier records.' },
              { label: 'Supply chain due diligence', text: 'Policy teams can assess Scope 3 data quality across sectors without requiring proprietary calculations.' },
              { label: 'Benchmark research', text: 'Sector energy intensity, water use, and emissions benchmarks with full data lineage for academic and policy research.' },
              { label: 'Audit and verification', text: 'Third-party auditors can access structured, source-linked records rather than unstructured documents.' },
            ].map(item => (
              <div
                key={item.label}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '6px',
                  padding: spacing[2],
                  display: 'flex',
                  gap: spacing[1],
                }}
              >
                <div
                  style={{
                    width: '3px',
                    flexShrink: 0,
                    backgroundColor: colours.navy,
                    borderRadius: '2px',
                    alignSelf: 'stretch',
                    opacity: 0.15,
                  }}
                />
                <div>
                  <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wide, textTransform: 'uppercase', margin: `0 0 4px` }}>
                    {item.label}
                  </p>
                  <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, lineHeight: 1.55, margin: 0 }}>
                    {item.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expression of interest form */}
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
            padding: spacing[4],
          }}
        >
          <h2
            style={{
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.medium,
              color: colours.navy,
              letterSpacing: typography.tracking.tight,
              margin: `0 0 ${spacing[1]}`,
            }}
          >
            Express an interest
          </h2>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `0 0 ${spacing[3]}`,
            }}
          >
            Tell us about your organisation and what you are looking for. We will follow up within five business days.
          </p>

          {submitted ? (
            <div
              style={{
                backgroundColor: colours.greenBg,
                border: `1px solid ${colours.green}`,
                borderRadius: '6px',
                padding: spacing[3],
              }}
            >
              <p
                style={{
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.medium,
                  color: colours.green,
                  margin: `0 0 6px`,
                }}
              >
                Enquiry received
              </p>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  margin: 0,
                }}
              >
                Thank you. We will be in touch within five business days.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[2], marginBottom: spacing[2] }}>
                <div>
                  <label style={labelStyle} htmlFor="orgName">Organisation name *</label>
                  <input
                    id="orgName"
                    type="text"
                    value={form.orgName}
                    onChange={e => set('orgName', e.target.value)}
                    placeholder="e.g. European Commission"
                    required
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="contactName">Contact name *</label>
                  <input
                    id="contactName"
                    type="text"
                    value={form.contactName}
                    onChange={e => set('contactName', e.target.value)}
                    placeholder="Your full name"
                    required
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[2], marginBottom: spacing[2] }}>
                <div>
                  <label style={labelStyle} htmlFor="email">Work email *</label>
                  <input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="you@organisation.gov"
                    required
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="role">Your role</label>
                  <input
                    id="role"
                    type="text"
                    value={form.role}
                    onChange={e => set('role', e.target.value)}
                    placeholder="e.g. Policy analyst"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginBottom: spacing[2] }}>
                <label style={labelStyle} htmlFor="interestArea">Primary area of interest *</label>
                <select
                  id="interestArea"
                  value={form.interestArea}
                  onChange={e => set('interestArea', e.target.value)}
                  required
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Select an area…</option>
                  {INTEREST_AREAS.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: spacing[3] }}>
                <label style={labelStyle} htmlFor="message">Additional context</label>
                <textarea
                  id="message"
                  value={form.message}
                  onChange={e => set('message', e.target.value)}
                  placeholder="Describe your use case, data needs, or any questions you have."
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
                />
              </div>

              {error && (
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.red,
                    backgroundColor: colours.redBg,
                    padding: '10px 12px',
                    borderRadius: '4px',
                    margin: `0 0 ${spacing[2]}`,
                  }}
                >
                  {error}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '12px 32px',
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: colours.surface,
                    backgroundColor: submitting ? colours.navyHover : colours.navy,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: submitting ? 'default' : 'pointer',
                  }}
                >
                  {submitting ? 'Sending…' : 'Send enquiry'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: colours.textTertiary,
            textAlign: 'center',
            margin: `${spacing[5]} 0 0`,
          }}
        >
          arbor, certified operational data repository
        </p>
      </main>
    </div>
  )
}
