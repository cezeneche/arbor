'use client'

import { useState, useRef } from 'react'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { colours, typography, spacing, layout } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

// Tall enough for an answer plus the first few records that back it up.
const PANEL_HEIGHT = 380

type NlRecord = {
  id: string
  entityName: string
  domain: string
  fieldName: string
  value: number
  unit: string
  periodStart: string
  periodEnd: string
  trustTier: 'A' | 'B' | 'C'
  confidenceScore: number | null
  sourceText: string | null
}

type QueryResult = {
  interpretation: string
  /** Claude's plain English answer, grounded only in the records below it. */
  answer?: string
  summary: string
  recordCount: number
  hasMore: boolean
  records: NlRecord[]
}


export function RecordsQueryPanel({
  children,
  plainTiers = false,
  // Built from the records this entity actually holds, so a suggested question
  // can never return an empty table.
  suggestions = [],
}: {
  children: React.ReactNode
  plainTiers?: boolean
  suggestions?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function toggle() {
    setOpen(prev => {
      if (!prev) setTimeout(() => inputRef.current?.focus(), 50)
      return !prev
    })
  }

  async function handleSearch(e: React.FormEvent, preset?: string) {
    e.preventDefault()
    const asked = preset ?? question
    if (!asked.trim() || loading) return
    if (preset) setQuestion(preset)

    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/query/nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: asked }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Query failed.')
      } else {
        // `ok()` sends the payload unwrapped — there is no `data` envelope.
        // Reading one silently produced undefined, which left this panel
        // sitting in its idle state however good the answer was.
        setResult(json)
      }
    } catch {
      setError('Could not reach the query engine.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Page content with bottom padding when panel is open */}
      <div style={{ paddingBottom: open ? PANEL_HEIGHT + 32 : 32 }}>
        {children}
      </div>

      {/* Toggle handle - fixed at bottom, offset by nav width */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={open ? 'Close query panel' : 'Open query panel'}
        onClick={toggle}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle()}
        style={{
          position: 'fixed',
          bottom: open ? PANEL_HEIGHT : 0,
          left: layout.navWidth,
          right: 0,
          height: '32px',
          backgroundColor: colours.navy,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: spacing[2],
          paddingRight: spacing[2],
          gap: '8px',
          cursor: 'pointer',
          zIndex: 40,
          userSelect: 'none',
          borderTop: open ? `1px solid rgba(255,255,255,0.1)` : 'none',
          transition: 'bottom 0.18s ease',
        }}
      >
        {/* Chevron */}
        <span
          style={{
            fontSize: '10px',
            color: 'rgba(255,255,255,0.6)',
            display: 'inline-block',
            transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.18s ease',
            lineHeight: 1,
          }}
        >
          ▲
        </span>
        <span
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: 'rgba(255,255,255,0.75)',
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
          }}
        >
          Query
        </span>
        {result && (
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.4)',
              marginLeft: '4px',
            }}
          >
            · {result.recordCount} result{result.recordCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Right side: close hint when open */}
        {open && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.3)',
              letterSpacing: typography.tracking.wide,
            }}
          >
            ESC to close
          </span>
        )}
      </div>

      {/* Panel body - fixed, slides up from bottom */}
      <div
        style={{
          position: 'fixed',
          bottom: open ? 0 : -PANEL_HEIGHT,
          left: layout.navWidth,
          right: 0,
          height: PANEL_HEIGHT,
          backgroundColor: colours.surface,
          borderTop: `2px solid ${colours.navy}`,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 39,
          transition: 'bottom 0.18s ease',
          overflow: 'hidden',
        }}
        onKeyDown={e => e.key === 'Escape' && open && setOpen(false)}
      >
        {/* Search bar */}
        <form
          onSubmit={handleSearch}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing[1],
            padding: `10px ${spacing[2]}`,
            borderBottom: `1px solid ${colours.border}`,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Ask
          </span>
          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. Show me energy records from last quarter"
            disabled={loading}
            style={{
              flex: 1,
              padding: '7px 12px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              backgroundColor: colours.background,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              outline: 'none',
              fontFamily: typography.fontFamily,
            }}
          />
          <button
            type="submit"
            disabled={!question.trim() || loading}
            style={{
              padding: '7px 16px',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: !question.trim() || loading ? colours.textTertiary : colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: !question.trim() || loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {/* Results area */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
          {/* Idle state */}
          {!result && !error && !loading && (
            <div style={{ padding: `${spacing[2]} ${spacing[2]}` }}>
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: `0 0 8px` }}>
                Ask about your own data in your own words. You get an answer and the exact records behind it, without leaving this page.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {suggestions.map(ex => (
                  <button
                    key={ex}
                    onClick={e => handleSearch(e, ex)}
                    style={{
                      padding: '4px 10px',
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      fontFamily: typography.fontFamily,
                      color: colours.textSecondary,
                      backgroundColor: 'transparent',
                      border: `1px solid ${colours.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ padding: `${spacing[2]} ${spacing[2]}` }}>
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                Reading your records…
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: `${spacing[2]} ${spacing[2]}` }}>
              <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.red, margin: 0 }}>
                {error}
              </p>
            </div>
          )}

          {/* Results summary */}
          {result && (
            <div>
              {/* The answer leads; the records that justify it sit underneath,
                  so nothing is ever asserted without its evidence in view. */}
              {result.answer && (
                <div style={{ padding: `${spacing[2]} ${spacing[2]}`, borderBottom: `1px solid ${colours.border}` }}>
                  <p
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textPrimary,
                      lineHeight: typography.lineHeight.body,
                      margin: 0,
                    }}
                  >
                    {result.answer}
                  </p>
                </div>
              )}
              <div style={{ padding: `8px ${spacing[2]}`, borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background, display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                  {result.summary}
                </span>
                <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                  · {result.interpretation}
                </span>
                {result.hasMore && (
                  <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.amber, marginLeft: 'auto' }}>
                    Showing top results - refine your query for more
                  </span>
                )}
              </div>

              {result.records.length === 0 ? (
                <div style={{ padding: `${spacing[2]} ${spacing[2]}` }}>
                  <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
                    No records matched this query.
                  </p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: colours.background }}>
                      {['Field', 'Value', 'Period', 'Domain', 'Tier'].map(col => (
                        <th
                          key={col}
                          style={{
                            padding: '6px 14px',
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.medium,
                            color: colours.textSecondary,
                            letterSpacing: typography.tracking.wider,
                            textTransform: 'uppercase',
                            textAlign: 'left',
                            whiteSpace: 'nowrap',
                            borderBottom: `1px solid ${colours.border}`,
                          }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.records.map((r, i) => (
                      <tr
                        key={r.id}
                        style={{ borderBottom: i < result.records.length - 1 ? `1px solid ${colours.border}` : 'none' }}
                      >
                        <td style={{ padding: '7px 14px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textPrimary, whiteSpace: 'nowrap' }}>
                          {r.fieldName.replace(/_/g, ' ')}
                        </td>
                        <td style={{ padding: '7px 14px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {r.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {r.unit}
                        </td>
                        <td style={{ padding: '7px 14px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' }}>
                          {new Date(r.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                          {' – '}
                          {new Date(r.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '7px 14px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, whiteSpace: 'nowrap' }}>
                          {DOMAIN_LABELS[r.domain] ?? r.domain}
                        </td>
                        <td style={{ padding: '7px 14px' }}>
                          <TierBadge tier={r.trustTier} plain={plainTiers} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
