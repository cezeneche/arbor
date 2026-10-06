'use client'

import { useEffect, useRef, useState } from 'react'

type Audience = 'supplier' | 'buyer' | 'importer' | 'general'

const plans: Record<Audience, string[]> = {
  supplier: ['Starter', 'Micro', 'Small', 'Growth'],
  buyer: ['Standard', 'Business', 'Enterprise'],
  importer: [],
  general: [],
}

export function PilotRequestForm({
  initialAudience,
  initialPlan,
}: {
  initialAudience: Audience
  initialPlan: string
}) {
  const [form, setForm] = useState({
    orgName: '',
    contactName: '',
    email: '',
    audience: initialAudience,
    plan: initialPlan,
    message: '',
    website: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const successRef = useRef<HTMLDivElement>(null)
  const requestId = useRef<string | null>(null)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])
  useEffect(() => {
    if (submitted) successRef.current?.focus()
  }, [submitted])

  function set(field: keyof typeof form, value: string) {
    setForm(previous => ({ ...previous, [field]: value }))
    requestId.current = null
    setError(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    try {
      requestId.current ??= window.crypto.randomUUID()
      const response = await fetch('/api/pilot-enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, requestId: requestId.current }),
        signal: controller.signal,
      })
      if (response.ok) {
        setSubmitted(true)
      } else {
        const data: unknown = await response.json().catch(() => null)
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : null
        setError(message ?? 'We could not save your request. Your entries are still here; please try again.')
      }
    } catch {
      setError(
        'We could not confirm receipt of your request. Your entries are still here. Check your connection and try again, or email hello@arbor.io.',
      )
    } finally {
      window.clearTimeout(timeout)
      setSubmitting(false)
    }
  }

  return (
    <div className="mk-request-card">
      {submitted ? (
        <div ref={successRef} tabIndex={-1} role="status" className="mk-request-success">
          <span className="mk-eyebrow">Request saved</span>
          <h2>Thank you for your interest.</h2>
          <p>
            Your pilot request has been saved. Access is by invitation. For follow-up, you can contact{' '}
            <a href="mailto:hello@arbor.io">hello@arbor.io</a>.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={submitting}>
          <h2>Request pilot access</h2>
          <p>Fields marked * are required.</p>
          <div className="mk-form-pair">
            <div>
              <label htmlFor="pilot-org">Organisation *</label>
              <input
                id="pilot-org"
                name="organization"
                autoComplete="organization"
                maxLength={200}
                required
                value={form.orgName}
                onChange={e => set('orgName', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pilot-name">Your name *</label>
              <input
                id="pilot-name"
                name="name"
                autoComplete="name"
                maxLength={120}
                required
                value={form.contactName}
                onChange={e => set('contactName', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="pilot-email">Work email *</label>
            <input
              id="pilot-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={200}
              required
              value={form.email}
              onChange={e => set('email', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="pilot-audience">What best describes you? *</label>
            <select
              id="pilot-audience"
              value={form.audience}
              required
              onChange={e => {
                setForm(previous => ({ ...previous, audience: e.target.value as Audience, plan: '' }))
                requestId.current = null
                setError(null)
              }}
            >
              <option value="general">Exploring Arbor</option>
              <option value="supplier">Supplier or manufacturer</option>
              <option value="buyer">Buyer or procurement team</option>
              <option value="importer">Importer with CBAM obligations</option>
            </select>
          </div>
          {plans[form.audience].length > 0 && (
            <div>
              <label htmlFor="pilot-plan">
                Plan of interest <span>(optional, indicative plans)</span>
              </label>
              <select id="pilot-plan" value={form.plan} onChange={e => set('plan', e.target.value)}>
                <option value="">No plan selected</option>
                {plans[form.audience].map(plan => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="pilot-message">
              What would you like to use Arbor for? <span>(optional)</span>
            </label>
            <textarea
              id="pilot-message"
              rows={5}
              maxLength={2000}
              value={form.message}
              onChange={e => set('message', e.target.value)}
              placeholder="For example, the documents you process or the supplier data you request"
            />
          </div>
          <div className="mk-honeypot" aria-hidden="true">
            <label htmlFor="pilot-website">Website</label>
            <input
              id="pilot-website"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={e => set('website', e.target.value)}
            />
          </div>
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="mk-form-error">
              {error}
            </p>
          )}
          <p className="mk-form-privacy">
            We use these details to handle your request. See our <a href="/legal/privacy">Privacy Policy</a>.
          </p>
          <button className="mk-button mk-button-navy" type="submit" disabled={submitting}>
            {submitting ? 'Saving request…' : 'Send request'}
          </button>
        </form>
      )}
    </div>
  )
}
