'use client'

import { useState } from 'react'
import { colours, spacing, typography, textStyles } from '@/lib/design-system'
import type { PresentedExplanation } from '@/lib/nucleos/explain-presenter'

// "Why this number?" under a goods-line figure: the words on the document it
// was read from, how sure the reading was, and whether a person corrected it.
// Opens inline, and only asks Nucleos when opened.

export interface ExplainedFigure {
  /** The goods-line field Nucleos holds the figure under. */
  field: string
  /** Shown above its sources when a cell explains more than one figure. */
  label?: string
}

const link = {
  padding: 0,
  marginTop: spacing[1],
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.light,
  color: colours.navy,
  background: 'none',
  border: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const

const quote = {
  margin: `${spacing[1]} 0 0`,
  padding: `${spacing[1]} ${spacing[2]}`,
  borderLeft: `2px solid ${colours.border}`,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  whiteSpace: 'pre-wrap' as const,
  maxWidth: '320px',
}

export function CbamWhyThisNumber({
  caseId,
  goodsLineId,
  figures,
  defaultNote,
}: {
  caseId: string
  goodsLineId: string
  figures: readonly ExplainedFigure[]
  /** Set when the figure is the published default: there is no document text to show. */
  defaultNote?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<{ figure: ExplainedFigure; explanation: PresentedExplanation }[] | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const base = `/api/cbam/cases/${encodeURIComponent(caseId)}/goods-lines/${encodeURIComponent(goodsLineId)}/explain`
      const loaded = await Promise.all(
        figures.map(async figure => {
          const res = await fetch(`${base}?field=${encodeURIComponent(figure.field)}`)
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error((body as { error?: string }).error ?? 'This could not be loaded.')
          return { figure, explanation: body as PresentedExplanation }
        }),
      )
      setResults(loaded)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !defaultNote && results === null && !loading) void load()
  }

  const nothing = results !== null && results.every(r => !r.explanation.available)

  return (
    <div>
      <button type="button" style={link} onClick={toggle} aria-expanded={open}>
        {open ? 'Hide' : 'Why this number?'}
      </button>
      {open && (
        <div style={{ marginTop: spacing[1] }}>
          {defaultNote ? (
            <p style={{ ...textStyles.caption, color: colours.textSecondary, maxWidth: '320px' }}>{defaultNote}</p>
          ) : loading ? (
            <p style={{ ...textStyles.caption, color: colours.textTertiary }}>Loading…</p>
          ) : error ? (
            <p style={{ ...textStyles.caption, color: colours.red }}>
              {error}{' '}
              <button type="button" style={{ ...link, marginTop: 0 }} onClick={() => void load()}>
                Try again
              </button>
            </p>
          ) : nothing ? (
            <p style={{ ...textStyles.caption, color: colours.textSecondary, maxWidth: '320px' }}>
              No document text was recorded for this figure. Cases opened before this was added do not have it.
            </p>
          ) : (
            results?.map(({ figure, explanation }) =>
              explanation.available ? (
                <div key={figure.field} style={{ marginBottom: spacing[2] }}>
                  {figure.label && (
                    <p style={{ ...textStyles.caption, color: colours.textTertiary }}>{figure.label}</p>
                  )}
                  {explanation.sources.map((source, i) => (
                    <div key={i}>
                      <blockquote style={quote}>{source.text}</blockquote>
                      <p style={{ ...textStyles.caption, color: colours.textSecondary }}>
                        {source.how}
                        {source.documentHref && (
                          <>
                            {' '}
                            <a href={source.documentHref} style={{ color: colours.navy }}>
                              View document
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null,
            )
          )}
        </div>
      )}
    </div>
  )
}
