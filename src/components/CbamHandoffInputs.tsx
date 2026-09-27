'use client'

import { useState } from 'react'
import { colours, spacing, typography } from '@/lib/design-system'
import type { HandoffState } from './CbamResumeHandoff'

export interface CaseIdentifierNeed {
  fieldName: string
  label: string
}

// The identifiers a confirmed document's case is waiting for. The figures are
// already saved; this adds only what the document did not say, and opens the
// case with it.

export function CbamHandoffInputs({
  documentId,
  needs,
  onResult,
}: {
  documentId: string
  needs: CaseIdentifierNeed[]
  onResult: (state: HandoffState) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const filled = needs.filter(n => (values[n.fieldName] ?? '').trim() !== '')

  async function submit() {
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const res = await fetch(`/api/cbam/handoffs/${encodeURIComponent(documentId)}/identifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: filled.map(n => ({ fieldName: n.fieldName, value: values[n.fieldName] })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errors = (body.fields ?? []) as { fieldName: string; message: string }[]
        setFieldErrors(Object.fromEntries(errors.map(e => [e.fieldName, e.message])))
        if (errors.length === 0) setError(body.error ?? 'The case could not be opened. Please try again shortly.')
        return
      }
      onResult(body as HandoffState)
    } catch {
      setError('The case could not be opened. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: spacing[3] }}>
      {needs.map(n => (
        <label key={n.fieldName} style={{ display: 'block', marginBottom: spacing[2] }}>
          <span
            style={{
              display: 'block',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              marginBottom: spacing[1],
            }}
          >
            {n.label}
          </span>
          <input
            value={values[n.fieldName] ?? ''}
            onChange={e => setValues(v => ({ ...v, [n.fieldName]: e.target.value }))}
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '7px 10px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              border: `1px solid ${fieldErrors[n.fieldName] ? colours.red : colours.border}`,
              borderRadius: '4px',
              backgroundColor: colours.surface,
            }}
          />
          {fieldErrors[n.fieldName] && (
            <span
              style={{
                display: 'block',
                marginTop: spacing[1],
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.red,
              }}
            >
              {fieldErrors[n.fieldName]}
            </span>
          )}
        </label>
      ))}
      <button
        type="button"
        onClick={submit}
        disabled={busy || filled.length === 0}
        style={{
          padding: '7px 16px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: colours.surface,
          backgroundColor: colours.navy,
          border: 'none',
          borderRadius: '4px',
          cursor: busy || filled.length === 0 ? 'default' : 'pointer',
          opacity: busy || filled.length === 0 ? 0.7 : 1,
        }}
      >
        {busy ? 'Opening the case…' : 'Open the case'}
      </button>
      {error && (
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.red,
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
