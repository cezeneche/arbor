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

  const copy = result ? STATUS_COPY[result.status] : null
  const toneColour =
    copy?.tone === 'in' ? colours.navy : copy?.tone === 'review' ? colours.amber : colours.textSecondary

  const fieldLabel: React.CSSProperties = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: `0 0 4px`,
  }
  const bareInput: React.CSSProperties = {
    flex: 1,
    height: '100%',
    border: 'none',
    outline: 'none',
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    fontFamily: 'inherit',
    color: colours.textPrimary,
    backgroundColor: 'transparent',
    padding: `0 ${spacing[3]}`,
    minWidth: 0,
  }

  return (
    <div style={{ maxWidth: '620px' }}>
      {/* One joined row: the two fields and the action read as a single question,
          which is what it is. Stacks below 768px, where a three-part row cannot
          hold its proportions. */}
      <style>{`
        .sc-row { display: flex; align-items: flex-end; }
        .sc-f1 { flex: 2; display: flex; flex-direction: column; min-width: 0; }
        .sc-f2 { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .sc-box { display: flex; align-items: stretch; height: 40px; overflow: hidden; }
        .sc-btn-stacked { display: none; }
        @media (max-width: 768px) {
          .sc-row { flex-direction: column; gap: 8px; align-items: stretch; }
          .sc-box, .sc-box-r { border-radius: 4px !important; border-right-width: 1px !important; }
          .sc-btn-inline { display: none; }
          .sc-btn-stacked { display: block; width: 100%; }
        }
      `}</style>

      <form onSubmit={check}>
        <div className="sc-row">
          <div className="sc-f1">
            <p style={fieldLabel}>Commodity code</p>
            <div
              className="sc-box"
              style={{
                border: `1px solid ${colours.border}`,
                borderRight: 'none',
                borderRadius: '4px 0 0 4px',
                backgroundColor: colours.surface,
              }}
            >
              <input
                id="cn"
                value={cnCode}
                onChange={e => setCnCode(e.target.value)}
                inputMode="numeric"
                required
                placeholder="8 digits, e.g. 72071111"
                style={bareInput}
              />
            </div>
          </div>

          <div className="sc-f2">
            <p style={fieldLabel}>
              Country of origin{' '}
              <span style={{ color: colours.textTertiary }}>optional</span>
            </p>
            <div
              className="sc-box sc-box-r"
              style={{
                border: `1px solid ${colours.border}`,
                borderRadius: '0 4px 4px 0',
                backgroundColor: colours.surface,
              }}
            >
              <input
                id="origin"
                value={origin}
                onChange={e => setOrigin(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="TR"
                style={{ ...bareInput, textTransform: 'uppercase' }}
              />
              <button
                type="submit"
                className="sc-btn-inline"
                disabled={busy}
                style={{
                  padding: `0 ${spacing[4]}`,
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  fontFamily: 'inherit',
                  color: '#FFFFFF',
                  backgroundColor: colours.navy,
                  border: 'none',
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {busy ? 'Checking…' : 'Check'}
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="sc-btn-stacked"
          disabled={busy}
          style={{
            marginTop: spacing[2],
            height: '40px',
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            fontFamily: 'inherit',
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

      <p
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.light,
          color: colours.textTertiary,
          margin: `${spacing[2]} 0 0`,
          lineHeight: 1.5,
        }}
      >
        The code is on your customs paperwork. Goods made in the EU are excluded, so the
        origin changes the answer.
      </p>

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
