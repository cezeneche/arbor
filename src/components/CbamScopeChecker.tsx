'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { scopeExposure } from '@/lib/nucleos/scope-exposure'
import { relevantScopeReasons } from '@/lib/nucleos/scope-reasons'
import type { ScopeCheckResult } from '@/lib/nucleos/scope-client'

// The question a user actually arrives with: does this even apply to me?
//
// It comes first because it is answerable in seconds, needs no document, and
// costs nothing to be wrong about — unlike everything else in this section.
//
// Two fields. The commodity code decides the answer. The tonnage does not — it
// decides what the answer is worth, and it recomputes as it is typed, with no
// second trip to the server. Re-checking to see a multiplication makes the
// number feel like a result rather than the arithmetic it is.
//
// Origin is deliberately absent. It changes the answer for EEA and linked-ETS
// countries, and the panel says so, but asking for it up front turns a
// ten-second check into a form. Somebody who needs origin applied has a case,
// and a case carries it.

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
    body: 'No CBAM declaration is needed for this commodity code.',
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
  const [tonnes, setTonnes] = useState('')
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
        body: JSON.stringify({ cn_code: cnCode }),
      })
      const body = await res.json()
      if (!res.ok) setError(body.error ?? 'The scope check could not be completed.')
      else setResult(body as ScopeCheckResult)
    } catch {
      setError('The scope check could not be completed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const fieldLabel: React.CSSProperties = { ...textStyles.caption, margin: '0 0 4px' }
  const boxBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    height: '40px',
    overflow: 'hidden',
    border: `1px solid ${colours.border}`,
    backgroundColor: colours.surface,
  }
  const bareInput: React.CSSProperties = {
    flex: 1,
    height: '100%',
    width: '100%',
    border: 'none',
    outline: 'none',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    fontFamily: 'inherit',
    color: colours.textPrimary,
    backgroundColor: 'transparent',
    padding: `0 ${spacing[3]}`,
    minWidth: 0,
    boxSizing: 'border-box',
  }

  const copy = result ? STATUS_COPY[result.status] : null
  const toneColour =
    copy?.tone === 'in' ? colours.navy : copy?.tone === 'review' ? colours.amber : colours.textSecondary

  // Derived from the field, not from a value captured at check time — so the
  // figure moves as the tonnage is typed, which is the whole point of it.
  const tonnesNumber = Number(tonnes)
  const exposure =
    result && result.default_see_tco2e_per_t
      ? scopeExposure({
          tonnes: tonnesNumber,
          defaultSeeTco2ePerT: result.default_see_tco2e_per_t,
        })
      : null

  const reasons = result ? relevantScopeReasons(result.reasons ?? []) : []

  return (
    <div style={{ maxWidth: '720px' }}>
      <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[3] }}>
        Find out if your imports are subject to CBAM
      </p>

      <style>{`
        .sc-row { display: flex; align-items: flex-end; }
        .sc-code { flex: 2; display: flex; flex-direction: column; min-width: 0; }
        .sc-tonnes { flex: 1; display: flex; flex-direction: column; min-width: 0; }
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
          <div className="sc-code">
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

          <div className="sc-tonnes">
            <p style={fieldLabel}>Annual tonnes</p>
            {/* The field and its unit only. The button used to live in this box
                and squeezed the input to nothing, so no figure could be typed. */}
            <div className="sc-box" style={{ ...boxBase, borderRight: 'none', borderRadius: 0 }}>
              <input
                value={tonnes}
                onChange={e => setTonnes(e.target.value)}
                type="number"
                min={0}
                step="1"
                placeholder="500"
                style={bareInput}
              />
              <span
                style={{
                  ...textStyles.caption,
                  display: 'flex',
                  alignItems: 'center',
                  paddingRight: spacing[3],
                  flexShrink: 0,
                }}
              >
                t
              </span>
            </div>
          </div>

          <button
            type="submit"
            className="sc-inline"
            disabled={busy}
            style={{
              height: '40px',
              padding: `0 ${spacing[5]}`,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              fontFamily: 'inherit',
              color: '#FFFFFF',
              backgroundColor: colours.navy,
              border: 'none',
              borderRadius: '0 4px 4px 0',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {busy ? 'Checking…' : 'Check'}
          </button>
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
        The code is on your customs paperwork. Tonnes are optional and change the estimate,
        not the answer.
      </p>

      {error && (
        <p style={{ ...textStyles.sectionSubtitle, color: colours.amber, margin: `${spacing[3]} 0 0` }}>
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

          {result.status === 'in_scope' && (
            <div
              style={{
                marginTop: spacing[3],
                paddingTop: spacing[3],
                borderTop: `1px solid ${colours.border}`,
              }}
            >
              <p style={textStyles.caption}>Embedded emissions at that volume</p>
              {exposure ? (
                <>
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
                  {/* No pound figure. That needs an HMRC-published rate, and where
                      the rate is a placeholder a currency total would be invented
                      in the most quotable position on the screen. */}
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
                </>
              ) : (
                <p style={{ ...textStyles.sectionSubtitle, margin: '2px 0 0' }}>
                  {result.default_see_tco2e_per_t
                    ? 'Enter your annual tonnage above to see what this means.'
                    : 'No published default value exists for this code, so no estimate can be shown.'}
                </p>
              )}
            </div>
          )}

          {reasons.length > 0 && (
            <ul
              style={{
                ...textStyles.caption,
                margin: `${spacing[3]} 0 0`,
                paddingLeft: '18px',
                lineHeight: 1.6,
              }}
            >
              {reasons.map(r => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {/* Origin is not asked for, so it cannot have been applied. Saying so
              is the difference between an answer and a half-answer. */}
          <p
            style={{
              ...textStyles.caption,
              color: colours.textTertiary,
              margin: `${spacing[3]} 0 0`,
              lineHeight: 1.5,
            }}
          >
            Based on the commodity code alone. Goods originating in the EU, EEA or a
            linked-ETS country are excluded regardless of code.
          </p>

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
