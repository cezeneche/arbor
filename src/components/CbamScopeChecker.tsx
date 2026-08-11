'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { scopeExposure } from '@/lib/nucleos/scope-exposure'
import type { ScopeCheckResult } from '@/lib/nucleos/scope-client'

// The question a user actually arrives with: does this even apply to me?
//
// It comes first because it is answerable in seconds, needs no document, and
// costs nothing to be wrong about — unlike everything else in this section.
//
// Three fields. Origin changes the answer outright (EU-origin goods are
// excluded). Tonnage does not change the answer but turns it into something
// actionable — CBAM is priced per tonne, so mass is what makes "yes" mean
// anything. Both are optional; the code alone gives a real answer.

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
  const [tonnes, setTonnes] = useState('')
  const [result, setResult] = useState<ScopeCheckResult | null>(null)
  const [checkedTonnes, setCheckedTonnes] = useState<number | null>(null)
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
        // Captured at check time, so the figure on screen always matches the
        // answer above it rather than drifting as the field is edited.
        setCheckedTonnes(Number(tonnes) > 0 ? Number(tonnes) : null)
      }
    } catch {
      setError('The scope check could not be completed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const fieldLabel: React.CSSProperties = { ...textStyles.caption, margin: '0 0 4px' }
  const bareInput: React.CSSProperties = {
    flex: 1,
    height: '100%',
    border: 'none',
    outline: 'none',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    fontFamily: 'inherit',
    color: colours.textPrimary,
    backgroundColor: 'transparent',
    padding: `0 ${spacing[3]}`,
    minWidth: 0,
  }
  const boxBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    height: '40px',
    overflow: 'hidden',
    border: `1px solid ${colours.border}`,
    backgroundColor: colours.surface,
  }

  const copy = result ? STATUS_COPY[result.status] : null
  const toneColour =
    copy?.tone === 'in' ? colours.navy : copy?.tone === 'review' ? colours.amber : colours.textSecondary

  const exposure =
    result && checkedTonnes && result.default_see_tco2e_per_t
      ? scopeExposure({
          tonnes: checkedTonnes,
          defaultSeeTco2ePerT: result.default_see_tco2e_per_t,
        })
      : null

  return (
    <div style={{ maxWidth: '680px' }}>
      {/* One joined row: the fields and the action read as a single question,
          which is what they are. Stacks below 768px, where four parts cannot
          hold their proportions. */}
      <style>{`
        .sc-row { display: flex; align-items: flex-end; }
        .sc-a { flex: 2; display: flex; flex-direction: column; min-width: 0; }
        .sc-b { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .sc-stacked { display: none; }
        @media (max-width: 768px) {
          .sc-row { flex-direction: column; gap: 8px; align-items: stretch; }
          .sc-box { border-radius: 4px !important; border-right-width: 1px !important; }
          .sc-inline { display: none; }
          .sc-stacked { display: block; width: 100%; }
        }
      `}</style>

      <form onSubmit={check}>
        <div className="sc-row">
          <div className="sc-a">
            <p style={fieldLabel}>Commodity code</p>
            <div
              className="sc-box"
              style={{ ...boxBase, borderRight: 'none', borderRadius: '4px 0 0 4px' }}
            >
              <input
                value={cnCode}
                onChange={e => setCnCode(e.target.value)}
                inputMode="numeric"
                required
                placeholder="8 digits, e.g. 72071111"
                style={bareInput}
              />
            </div>
          </div>

          <div className="sc-b">
            <p style={fieldLabel}>Origin</p>
            <div className="sc-box" style={{ ...boxBase, borderRight: 'none', borderRadius: 0 }}>
              <input
                value={origin}
                onChange={e => setOrigin(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="TR"
                style={{ ...bareInput, textTransform: 'uppercase' }}
              />
            </div>
          </div>

          <div className="sc-b">
            <p style={fieldLabel}>Tonnes per year</p>
            <div className="sc-box" style={{ ...boxBase, borderRadius: '0 4px 4px 0' }}>
              <input
                value={tonnes}
                onChange={e => setTonnes(e.target.value)}
                inputMode="decimal"
                type="number"
                min={0}
                step="0.1"
                placeholder="100"
                style={bareInput}
              />
              <button
                type="submit"
                className="sc-inline"
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
          className="sc-stacked"
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

      <p style={{ ...textStyles.caption, margin: `${spacing[2]} 0 0`, lineHeight: 1.5 }}>
        The code is on your customs paperwork. Goods made in the EU are excluded, so origin
        changes the answer. Tonnes are optional and change only the estimate, not the answer.
      </p>

      {error && (
        <p
          style={{
            ...textStyles.sectionSubtitle,
            color: colours.amber,
            margin: `${spacing[3]} 0 0`,
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
            borderRadius: '0 6px 6px 0',
            padding: spacing[3],
            backgroundColor: colours.surface,
          }}
        >
          <p style={textStyles.sectionTitle}>{copy.headline}</p>
          <p style={{ ...textStyles.sectionSubtitle, margin: `6px 0 0`, lineHeight: 1.6 }}>
            {copy.body}
          </p>

          {result.sector && (
            <p style={{ ...textStyles.value, margin: `${spacing[2]} 0 0` }}>
              Sector: {result.sector.replace(/_/g, ' ')}
            </p>
          )}

          {exposure && (
            <div
              style={{
                marginTop: spacing[3],
                paddingTop: spacing[3],
                borderTop: `1px solid ${colours.border}`,
              }}
            >
              <p style={textStyles.caption}>Embedded emissions at that volume</p>
              <p
                style={{
                  ...textStyles.sectionTitle,
                  margin: '2px 0 0',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {exposure.embeddedTco2e.toLocaleString('en-GB')} tCO₂e per year
              </p>
              <p style={{ ...textStyles.caption, margin: `${spacing[2]} 0 0`, lineHeight: 1.5 }}>
                {exposure.basis}
              </p>
              {/* No pound figure. That needs an HMRC-published rate, and where the
                  rate is a placeholder a currency total would be invented in the
                  most quotable position on the screen. */}
              <p
                style={{
                  ...textStyles.caption,
                  color: colours.amber,
                  margin: `${spacing[2]} 0 0`,
                  lineHeight: 1.5,
                }}
              >
                {exposure.qualification}
              </p>
            </div>
          )}

          {checkedTonnes && !exposure && result.status === 'in_scope' && (
            <p style={{ ...textStyles.caption, margin: `${spacing[2]} 0 0` }}>
              No published default value was found for this code, so no emissions estimate
              can be shown.
            </p>
          )}

          {result.reasons?.length > 0 && (
            <ul
              style={{
                ...textStyles.sectionSubtitle,
                margin: `${spacing[2]} 0 0`,
                paddingLeft: '18px',
              }}
            >
              {result.reasons.map(r => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {/* The provisions relied on. An answer without these is an opinion. */}
          {result.regulation_refs?.length > 0 && (
            <p style={{ ...textStyles.caption, color: colours.textTertiary, margin: `${spacing[2]} 0 0` }}>
              {result.regulation_refs.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
