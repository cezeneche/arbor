'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, controls, spacing, textStyles, typography } from '@/lib/design-system'
import type { FlaggedRecordItem } from '@/lib/review/flagged-records'

// Review's second list: saved records with an open flag. Each has three ways
// out, all inline: correct the value (the primary action), keep it with a note,
// or upload a corrected document. A critical flag has no "keep".

type Mode = { flagId: string; kind: 'correct' | 'keep' } | null

const bodyText = {
  margin: 0,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  lineHeight: typography.lineHeight.body,
  color: colours.textPrimary,
} as const

export function FlaggedRecords({ initial }: { initial: FlaggedRecordItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [mode, setMode] = useState<Mode>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string[]>([])

  if (items.length === 0 && done.length === 0) return null

  function open(item: FlaggedRecordItem, kind: 'correct' | 'keep') {
    setMode({ flagId: item.flagId, kind })
    setDraft(kind === 'correct' ? item.value : '')
    setErrors(e => ({ ...e, [item.flagId]: '' }))
  }

  async function save(item: FlaggedRecordItem, kind: 'correct' | 'keep') {
    setBusy(item.flagId)
    const body = kind === 'correct' ? { action: 'correct', value: draft } : { action: 'keep', note: draft }
    const res = await fetch(`/api/flags/${encodeURIComponent(item.flagId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    setBusy(null)

    if (!res?.ok) {
      const data = res ? await res.json().catch(() => null) : null
      setErrors(e => ({ ...e, [item.flagId]: data?.error ?? 'Could not save. Try again.' }))
      return
    }
    const what = `${item.title}, ${item.period}`
    setDone(d => [
      ...d,
      kind === 'correct'
        ? `${what}: corrected. A value typed in without a document is marked Declared - upload the corrected document to make it Verified.`
        : `${what}: kept, with your note.`,
    ])
    setItems(list => list.filter(i => i.flagId !== item.flagId))
    setMode(null)
    router.refresh()
  }

  return (
    <section style={{ marginTop: spacing[6] }}>
      <h2 style={textStyles.sectionTitle}>
        Records that need a decision{items.length > 0 ? ` (${items.length})` : ''}
      </h2>
      <p
        style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 ${spacing[3]}`, maxWidth: '640px' }}
      >
        Already saved, but something about them looks wrong. Correct the value, say why it is right, or upload
        a corrected document.
      </p>

      {done.length > 0 && (
        <div
          style={{
            border: `1px solid ${colours.border}`,
            borderLeft: `3px solid ${colours.green}`,
            borderRadius: '6px',
            padding: spacing[3],
            marginBottom: spacing[3],
            backgroundColor: colours.greenBg,
            display: 'grid',
            gap: spacing[1],
          }}
        >
          {done.map((line, i) => (
            <p key={i} style={bodyText}>
              {line}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: spacing[3] }}>
        {items.map(item => {
          const editing = mode?.flagId === item.flagId ? mode.kind : null
          const inputId = `flag-${item.flagId}`
          return (
            <article
              key={item.flagId}
              style={{
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '8px',
                padding: spacing[3],
                display: 'grid',
                gap: spacing[2],
                overflowWrap: 'anywhere',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: spacing[2],
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <p style={textStyles.rowTitle}>{item.title}</p>
                  <p style={{ ...textStyles.caption, margin: `${spacing[1]} 0 0` }}>
                    {item.period} · saved as {item.value} {item.unit}
                  </p>
                </div>
                {(item.mustFix || item.overdue) && (
                  <span
                    style={{
                      ...textStyles.caption,
                      alignSelf: 'flex-start',
                      color: item.mustFix ? colours.red : colours.amber,
                      backgroundColor: item.mustFix ? colours.redBg : colours.amberBg,
                      borderRadius: '4px',
                      padding: '2px 8px',
                    }}
                  >
                    {item.mustFix ? 'Needs fixing' : 'Past its deadline'}
                  </span>
                )}
              </div>

              <p
                style={{
                  ...bodyText,
                  borderLeft: `3px solid ${item.mustFix ? colours.red : colours.amber}`,
                  paddingLeft: spacing[2],
                }}
              >
                {item.message}
              </p>

              {editing === null && (
                <div style={{ display: 'flex', gap: spacing[2], flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" onClick={() => open(item, 'correct')} style={controls.primaryButton}>
                    Correct it
                  </button>
                  {item.canKeep && (
                    <button type="button" onClick={() => open(item, 'keep')} style={controls.secondaryButton}>
                      Keep this value
                    </button>
                  )}
                  <a
                    href="/upload"
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.navy,
                    }}
                  >
                    Upload a corrected document
                  </a>
                </div>
              )}

              {editing === 'correct' && (
                <div style={{ display: 'grid', gap: spacing[2] }}>
                  <label htmlFor={inputId} style={textStyles.rowTitle}>
                    Corrected value
                  </label>
                  <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      id={inputId}
                      inputMode="decimal"
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      style={{ ...controls.input, width: '180px' }}
                    />
                    <span style={textStyles.caption}>{item.unit}</span>
                  </div>
                  <p style={textStyles.caption}>
                    Without a document this is marked Declared. Upload the corrected document instead and it
                    can be Verified.
                  </p>
                </div>
              )}

              {editing === 'keep' && (
                <div style={{ display: 'grid', gap: spacing[2] }}>
                  <label htmlFor={inputId} style={textStyles.rowTitle}>
                    Why this value is right
                  </label>
                  <textarea
                    id={inputId}
                    rows={3}
                    maxLength={1000}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    style={{ ...controls.input, resize: 'vertical', maxWidth: '640px' }}
                  />
                  <p style={textStyles.caption}>Your note is kept with the record&apos;s history.</p>
                </div>
              )}

              {editing !== null && (
                <div style={{ display: 'flex', gap: spacing[2], flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => save(item, editing)}
                    disabled={busy !== null}
                    style={{ ...controls.primaryButton, opacity: busy === item.flagId ? 0.6 : 1 }}
                  >
                    {busy === item.flagId
                      ? 'Saving…'
                      : editing === 'correct'
                        ? 'Save correction'
                        : 'Save note'}
                  </button>
                  <button type="button" onClick={() => setMode(null)} style={controls.secondaryButton}>
                    Cancel
                  </button>
                </div>
              )}

              {errors[item.flagId] && (
                <p style={{ ...bodyText, color: colours.red }} role="alert">
                  {errors[item.flagId]}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
