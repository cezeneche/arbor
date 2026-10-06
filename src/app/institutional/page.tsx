'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { PublicNav } from '@/components/marketing/PublicNav'
import { SkipLink, MAIN_CONTENT_ID } from '@/components/marketing/SkipLink'
import { PublicFooter } from '@/components/marketing/PublicFooter'
import '../(marketing)/marketing.css'

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
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await fetch('/api/institutional/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        signal: controller.signal,
      })

      if (res.ok) {
        setSubmitted(true)
      } else {
        const data: unknown = await res.json().catch(() => null)
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : null
        setError(message ?? 'We could not save your enquiry. Your entries are still here; please try again.')
      }
    } catch {
      setError(
        'We could not confirm receipt of your enquiry. Your entries are still here. Check your connection and try again, or email hello@arbor.io.',
      )
    } finally {
      window.clearTimeout(timeout)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="mk-site"
      style={{
        minHeight: '100vh',
        backgroundColor: colours.background,
        fontFamily: typography.fontFamily,
      }}
    >
      <SkipLink />
      <PublicNav />

      {/* The site's shared container, so this page's edges line up with the
          header, the footer and every other page. */}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mk-container"
        style={{ padding: `${spacing[8]} 0` }}
      >
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
            Operational data for
            <br />
            research and institutional use
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
            Arbor is an operational data platform. Manufacturers and suppliers upload production documents.
            The platform extracts and stores operational figures with evidence-quality labels.
            Document-derived records include available source evidence; declared and estimated figures are
            labelled separately.
          </p>
        </div>

        {/* Three-column feature grid */}
        <div
          className="mk-institutional-features"
          style={{
            gap: spacing[2],
            marginBottom: spacing[8],
          }}
        >
          {[
            {
              title: 'Document-backed records',
              body: 'Document-derived records link operational figures to available source text from bills, production logs, invoices, and certificates. A source link does not independently verify the underlying claim.',
            },
            {
              title: 'Sector benchmarks',
              body: 'Sector statistics use opted-in supplier data and require at least 10 qualifying entities per benchmark cell. Coverage depends on available data; contact us to discuss your requirements.',
            },
            {
              title: 'Evidence-quality labels',
              body: 'Verified records meet source and review requirements. Declared records include self-reported figures and document-derived figures that have not met those requirements. Estimated records use reference values. These labels describe evidence quality, not independent assurance.',
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
            Institutional use cases to explore
          </h2>
          <div className="mk-institutional-pairs" style={{ gap: spacing[2] }}>
            {[
              {
                label: 'CBAM compliance',
                text: 'Regulators can cross-reference declared embedded emissions against supplier records labelled by evidence quality.',
              },
              {
                label: 'Supply chain due diligence',
                text: 'Policy teams can assess Scope 3 data quality across sectors without requiring proprietary calculations.',
              },
              {
                label: 'Benchmark research',
                text: 'Explore available energy, water, and emissions statistics, with coverage and methodology assessed for your research question.',
              },
              {
                label: 'Audit and verification',
                text: 'Third-party auditors can access structured, source-linked records rather than unstructured documents.',
              },
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
                  <p
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.textTertiary,
                      letterSpacing: typography.tracking.wide,
                      textTransform: 'uppercase',
                      margin: `0 0 4px`,
                    }}
                  >
                    {item.label}
                  </p>
                  <p
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
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
            padding: 'clamp(20px, 4vw, 32px)',
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
          <p style={{ ...textStyles.sectionSubtitle, margin: `0 0 ${spacing[3]}` }}>
            Tell us about your organisation and what you are looking for. Fields marked * are required.
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              color: colours.textSecondary,
              lineHeight: 1.6,
              margin: `0 0 ${spacing[3]}`,
            }}
          >
            We use the details you provide to handle your enquiry. See our{' '}
            <a href="/legal/privacy" style={{ color: colours.navy, textDecoration: 'underline' }}>
              Privacy Policy
            </a>
            .
          </p>

          <div role="status" aria-live="polite" aria-atomic="true">
            {submitted && (
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
                <p style={textStyles.sectionSubtitle}>
                  Your enquiry has been saved. For follow-up, contact hello@arbor.io.
                </p>
              </div>
            )}
          </div>
          {!submitted && (
            <form onSubmit={handleSubmit} aria-busy={submitting}>
              <div className="mk-institutional-pairs" style={{ gap: spacing[2], marginBottom: spacing[2] }}>
                <div>
                  <label style={labelStyle} htmlFor="orgName">
                    Organisation name *
                  </label>
                  <input
                    id="orgName"
                    name="organisation"
                    autoComplete="organization"
                    maxLength={200}
                    type="text"
                    value={form.orgName}
                    onChange={e => set('orgName', e.target.value)}
                    placeholder="e.g. European Commission"
                    required
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="contactName">
                    Contact name *
                  </label>
                  <input
                    id="contactName"
                    name="name"
                    autoComplete="name"
                    maxLength={120}
                    type="text"
                    value={form.contactName}
                    onChange={e => set('contactName', e.target.value)}
                    placeholder="Your full name"
                    required
                    style={inputStyle}
                  />
                </div>
              </div>

              <div className="mk-institutional-pairs" style={{ gap: spacing[2], marginBottom: spacing[2] }}>
                <div>
                  <label style={labelStyle} htmlFor="email">
                    Work email *
                  </label>
                  <input
                    id="email"
                    name="email"
                    autoComplete="email"
                    maxLength={200}
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="you@organisation.gov"
                    required
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="role">
                    Your role
                  </label>
                  <input
                    id="role"
                    name="role"
                    autoComplete="organization-title"
                    maxLength={120}
                    type="text"
                    value={form.role}
                    onChange={e => set('role', e.target.value)}
                    placeholder="e.g. Policy analyst"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginBottom: spacing[2] }}>
                <label style={labelStyle} htmlFor="interestArea">
                  Primary area of interest *
                </label>
                <select
                  id="interestArea"
                  value={form.interestArea}
                  onChange={e => set('interestArea', e.target.value)}
                  required
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Select an area…</option>
                  {INTEREST_AREAS.map(a => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: spacing[3] }}>
                <label style={labelStyle} htmlFor="message">
                  Additional context
                </label>
                <textarea
                  id="message"
                  maxLength={4000}
                  value={form.message}
                  onChange={e => set('message', e.target.value)}
                  placeholder="Describe your use case, data needs, or any questions you have."
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
                />
              </div>

              {error && (
                <p
                  role="alert"
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
      </main>
      <PublicFooter />
    </div>
  )
}
