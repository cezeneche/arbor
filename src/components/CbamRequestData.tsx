'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { CbamCasePicker } from './CbamCasePicker'
import { DATA_PATHS, type DataPathId } from '@/lib/nucleos/data-path'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'
import type { DefaultValueEntry } from '@/lib/nucleos/default-value-client'

// Filling the emissions figure a goods line is missing.
//
// The two paths are shown side by side and neither is preselected, because the
// choice is a real one with a cost either way: chasing a supplier takes time,
// and not chasing them costs money through the mark-up. Preselecting would make
// that trade-off for the user without telling them it existed.

interface GoodsLine {
  id: string
  cn_code?: string | null
  description?: string | null
  sector?: string | null
}

function PathCard({
  path,
  selected,
  onSelect,
}: {
  path: (typeof DATA_PATHS)[number]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        flex: 1,
        textAlign: 'left',
        cursor: 'pointer',
        border: `1px solid ${colours.border}`,
        borderLeft: selected ? `3px solid ${colours.navy}` : `1px solid ${colours.border}`,
        borderRadius: selected ? '0 6px 6px 0' : '6px',
        padding: `${spacing[3]} ${spacing[4]}`,
        backgroundColor: selected ? colours.surface : colours.background,
        fontFamily: 'inherit',
      }}
    >
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: selected ? colours.navy : colours.textPrimary,
          margin: `0 0 ${spacing[2]}`,
        }}
      >
        {path.title}
      </p>
      <p
        style={{
          ...textStyles.sectionSubtitle,
          lineHeight: 1.6,
          margin: `0 0 ${spacing[2]}`,
        }}
      >
        {path.body}
      </p>
      <p
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.light,
          color: path.markupApplies ? colours.amber : colours.textTertiary,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {path.consequence}
      </p>
    </button>
  )
}

function CaseRequest({ caseId }: { caseId: string }) {
  const [path, setPath] = useState<DataPathId | null>(null)
  const [lines, setLines] = useState<GoodsLine[] | null>(null)
  const [lineId, setLineId] = useState('')
  const [loadingLines, setLoadingLines] = useState(false)

  const [formUrl, setFormUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [defaults, setDefaults] = useState<DefaultValueEntry[] | null>(null)

  async function loadLines(): Promise<GoodsLine[]> {
    if (lines) return lines
    setLoadingLines(true)
    try {
      const res = await fetch(`/api/cbam/cases/${caseId}`)
      const body = await res.json()
      const gl: GoodsLine[] = res.ok ? (body.goods_lines ?? []) : []
      setLines(gl)
      if (gl[0]) setLineId(gl[0].id)
      return gl
    } catch {
      setLines([])
      return []
    } finally {
      setLoadingLines(false)
    }
  }

  async function choose(next: DataPathId) {
    setPath(next)
    setError(null)
    const gl = await loadLines()

    if (next === 'default') {
      const cn = gl.find(l => l.id === lineId)?.cn_code ?? gl[0]?.cn_code
      if (!cn) {
        setDefaults([])
        return
      }
      try {
        const res = await fetch(`/api/cbam/default-value?q=${encodeURIComponent(cn)}`)
        const body = await res.json()
        setDefaults(res.ok ? (body.results ?? []) : [])
      } catch {
        setDefaults([])
      }
    }
  }

  async function generateLink() {
    const gl = await loadLines()
    const target = lineId || gl[0]?.id
    if (!target) {
      setError('This case has no goods lines yet, so there is nothing to ask about.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cbam/supplier-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goods_line_id: target }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'The link could not be created.')
        return
      }
      setFormUrl(body.form_url)
      setExpiresAt(body.expires_at ?? null)
    } catch {
      setError('The link could not be created. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const section: React.CSSProperties = {
    padding: `${spacing[4]} 0`,
    borderTop: `1px solid ${colours.border}`,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: spacing[2],
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    fontFamily: 'inherit',
    color: colours.textPrimary,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
    boxSizing: 'border-box',
  }
  const buttonStyle = (disabled: boolean): React.CSSProperties => ({
    padding: `${spacing[2]} ${spacing[4]}`,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    fontFamily: 'inherit',
    color: '#FFFFFF',
    backgroundColor: colours.navy,
    border: 'none',
    borderRadius: '4px',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  })

  return (
    <div style={section}>
      <div style={{ display: 'flex', gap: spacing[3], marginBottom: spacing[4] }}>
        {DATA_PATHS.map(p => (
          <PathCard key={p.id} path={p} selected={path === p.id} onSelect={() => choose(p.id)} />
        ))}
      </div>

      {loadingLines && (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
          Loading goods lines…
        </p>
      )}

      {path && lines && lines.length > 1 && (
        <div style={{ marginBottom: spacing[3], maxWidth: '420px' }}>
          <p
            style={{
              ...textStyles.caption,
              margin: `0 0 4px`,
            }}
          >
            Goods line
          </p>
          <select
            value={lineId}
            onChange={e => setLineId(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {lines.map(l => (
              <option key={l.id} value={l.id}>
                {l.cn_code ?? 'No code'} · {l.description || l.sector || 'No description'}
              </option>
            ))}
          </select>
        </div>
      )}

      {path === 'supplier' && (
        <div style={{ maxWidth: '520px' }}>
          {!formUrl ? (
            <>
              <p
                style={{
                  ...textStyles.sectionSubtitle,
                  margin: `0 0 ${spacing[3]}`,
                  lineHeight: 1.6,
                }}
              >
                The link works once, for this goods line only, and expires. Send it to
                whoever at the supplier knows the production data.
              </p>
              <button onClick={generateLink} disabled={busy} style={buttonStyle(busy)}>
                {busy ? 'Creating…' : 'Create supplier link'}
              </button>
            </>
          ) : (
            <div
              style={{
                border: `1px solid ${colours.border}`,
                borderLeft: `3px solid ${colours.navy}`,
                borderRadius: '0 6px 6px 0',
                padding: spacing[3],
                backgroundColor: colours.surface,
              }}
            >
              <p
                style={{
                  ...textStyles.rowTitle,
                  margin: `0 0 ${spacing[2]}`,
                }}
              >
                Send this to the supplier
              </p>
              <p
                style={{
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textPrimary,
                  wordBreak: 'break-all',
                  fontFamily: 'ui-monospace, monospace',
                  margin: `0 0 ${spacing[2]}`,
                }}
              >
                {formUrl}
              </p>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(formUrl)
                  setCopied(true)
                }}
                style={{
                  padding: `6px ${spacing[3]}`,
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.medium,
                  fontFamily: 'inherit',
                  color: colours.navy,
                  backgroundColor: 'transparent',
                  border: `1px solid ${colours.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {expiresAt && (
                <p
                  style={{
                    ...textStyles.caption,
          color: colours.textTertiary,
                    margin: `${spacing[2]} 0 0`,
                  }}
                >
                  Expires {new Date(expiresAt).toLocaleDateString('en-GB')}. After that you
                  will need to create a new one.
                </p>
              )}
            </div>
          )}

          {error && (
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.amber,
                marginTop: spacing[3],
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}

      {path === 'default' && defaults && (
        <div style={{ maxWidth: '520px' }}>
          {defaults.length === 0 ? (
            <p
              style={{
                ...textStyles.sectionSubtitle,
                margin: 0,
              }}
            >
              No published default could be found for this commodity code.
            </p>
          ) : (
            <>
              {defaults.slice(0, 3).map(d => (
                <div
                  key={d.cn8_code}
                  style={{
                    border: `1px solid ${colours.border}`,
                    borderRadius: '6px',
                    padding: spacing[3],
                    marginBottom: spacing[2],
                    backgroundColor: colours.surface,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span
                      style={{
                        ...textStyles.sectionSubtitle,
                      }}
                    >
                      {d.cn8_code} · {d.description}
                    </span>
                    <span
                      style={{
                        ...textStyles.rowTitle,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        paddingLeft: spacing[3],
                      }}
                    >
                      {d.default_see_tco2e_per_t} tCO₂e/t
                    </span>
                  </div>
                  <p
                    style={{
                      ...textStyles.caption,
          color: colours.textTertiary,
                      margin: `4px 0 0`,
                    }}
                  >
                    {d.direct_tco2e_per_t} direct · {d.indirect_tco2e_per_t} indirect
                  </p>
                </div>
              ))}

              {/* The figure above is the published value before the mark-up. Showing
                  it without this line would understate what ends up on the return. */}
              <p
                style={{
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.amber,
                  lineHeight: 1.6,
                  margin: `${spacing[2]} 0 0`,
                }}
              >
                This is the published value before the legislated mark-up. The mark-up is
                added when the declaration is built, so the declarable figure will be
                higher than the number shown here.
              </p>
              <p
                style={{
                  ...textStyles.caption,
          color: colours.textTertiary,
                  lineHeight: 1.6,
                  margin: `${spacing[2]} 0 0`,
                }}
              >
                EU 2023/1773 Annex VI — world-average default values
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function CbamRequestData({ cases }: { cases: CbamCaseSummary[] }) {
  return (
    <div>
      <CbamCasePicker
        cases={cases}
        emptyMessage="There are no cases yet. Start one from Cases, and its goods lines will appear here."
      >
        {c => <CaseRequest caseId={c.id} />}
      </CbamCasePicker>
    </div>
  )
}
