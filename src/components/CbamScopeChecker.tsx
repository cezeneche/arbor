'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import type { ScopeCheckResult } from '@/lib/nucleos/scope-client'

// The question a user actually arrives with: does this even apply to me?
//
// It comes first because it is answerable in seconds, needs no document, and
// costs nothing to be wrong about — unlike everything else in this section.
//
// Two fields. Origin country changes the answer (EU-origin goods are excluded),
// so it is asked; everything else is refinement and is left out.

const STATUS_COPY: Record<
  ScopeCheckResult['status'],
  { headline: string; body: string; tone: 'in' | 'out' | 'review' }
> = {
  in_scope: {
    headline: 'These goods are in scope',
    body: 'A CBAM declaration will be required. Upload the customs declaration or supplier invoice to start building one.',
    tone: 'in',
  },
  out_of_scope: {
    headline: 'These goods are out of scope',
    body: 'No CBAM declaration is needed for this commodity code and origin.',
    tone: 'out',
  },
  requires_review: {
    headline: 'This needs a closer look',
    body: 'The commodity code is covered, but something about this import needs checking before scope can be settled.',
    tone: 'review',
  },
}

export function CbamScopeChecker() {
  const [cnCode, setCnCode] = useState('')
  const [origin, setOrigin] = useState('')
  const [result, setResult] = useState<ScopeCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      const res = await fetch('/api/cbam/scope-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cn_code: cnCode, origin_country: origin || null }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'The scope check could not be completed.')
      } else {
        setResult(body as ScopeCheckResult)
      }
    } catch {
      setError('The scope check could not be completed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = {
    display: 'block',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    marginBottom: '4px',
  }
  const hint = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: '0 0 6px',
  }
  const input = {
    width: '100%',
    padding: spacing[2],
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
  }

  const copy = result ? STATUS_COPY[result.status] : null
  const toneColour =
    copy?.tone === 'in' ? colours.navy : copy?.tone === 'review' ? colours.amber : colours.textSecondary

  return (
    <div style={{ maxWidth: '520px' }}>
      <form onSubmit={check}>
        <div style={{ marginBottom: spacing[3] }}>
          <label htmlFor="cn" style={label}>Commodity code</label>
          <p style={hint}>The 8-digit code from your customs paperwork. For example, 72071111.</p>
          <input
            id="cn"
            value={cnCode}
            onChange={e => setCnCode(e.target.value)}
            inputMode="numeric"
            required
            style={input}
          />
        </div>

        <div style={{ marginBottom: spacing[3] }}>
          <label htmlFor="origin" style={label}>
            Country of origin{' '}
            <span style={{ fontWeight: typography.weights.light, color: colours.textSecondary }}>
              Optional
            </span>
          </label>
          <p style={hint}>Two-letter code, such as TR or IN. Goods made in the EU are excluded.</p>
          <input
            id="origin"
            value={origin}
            onChange={e => setOrigin(e.target.value.toUpperCase())}
            maxLength={2}
            style={{ ...input, textTransform: 'uppercase' }}
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: `${spacing[2]} ${spacing[4]}`,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            color: '#FFFFFF',
            backgroundColor: colours.navy,
            border: 'none',
            borderRadius: '4px',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Checking…' : 'Check scope'}
        </button>
      </form>

      {error && (
        <p
          style={{
            marginTop: spacing[3],
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.amber,
          }}
        >
          {error}
        </p>
      )}

      {result && copy && (
        <div
          style={{
            marginTop: spacing[4],
            border: `1px solid ${colours.border}`,
            borderLeft: `3px solid ${toneColour}`,
            borderRadius: '6px',
            padding: spacing[3],
            backgroundColor: colours.surface,
          }}
        >
          <div
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
            }}
          >
            {copy.headline}
          </div>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `6px 0 0`,
            }}
          >
            {copy.body}
          </p>

          {result.sector && (
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
                margin: `${spacing[2]} 0 0`,
              }}
            >
              Sector: {result.sector.replace(/_/g, ' ')}
            </p>
          )}

          {result.reasons?.length > 0 && (
            <ul
              style={{
                margin: `${spacing[2]} 0 0`,
                paddingLeft: '18px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
              }}
            >
              {result.reasons.map(r => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {/* The provisions relied on. An answer without these is an opinion. */}
          {result.regulation_refs?.length > 0 && (
            <p
              style={{
                margin: `${spacing[2]} 0 0`,
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
              }}
            >
              {result.regulation_refs.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
