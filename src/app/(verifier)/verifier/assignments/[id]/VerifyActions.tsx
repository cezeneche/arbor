'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

// inline verify / reject actions. No modal (design rule); the reject
// note field expands inline.
export function VerifyActions({ assignmentId }: { assignmentId: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: 'verify' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/verifier/assignments/${assignmentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: action === 'reject' ? note : undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong')
        setBusy(false)
        return
      }
      router.refresh()
    } catch {
      setError('Network error')
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: spacing[3], display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
      {error && (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red, margin: 0 }}>
          {error}
        </p>
      )}

      {mode === 'rejecting' && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Explain why this package cannot be verified…"
          rows={3}
          style={{
            width: '100%',
            padding: spacing[2],
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textPrimary,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            fontFamily: typography.fontFamily,
            resize: 'vertical',
          }}
        />
      )}

      <div style={{ display: 'flex', gap: spacing[2] }}>
        {mode === 'idle' ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('verify')}
              style={{
                padding: '10px 20px',
                backgroundColor: colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                border: 'none',
                borderRadius: '4px',
                cursor: busy ? 'default' : 'pointer',
                letterSpacing: typography.tracking.wide,
              }}
            >
              {busy ? 'Working…' : 'Verify'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('rejecting')}
              style={{
                padding: '10px 20px',
                backgroundColor: 'transparent',
                color: colours.red,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Reject with note
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || note.trim() === ''}
              onClick={() => submit('reject')}
              style={{
                padding: '10px 20px',
                backgroundColor: colours.red,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                border: 'none',
                borderRadius: '4px',
                cursor: busy || note.trim() === '' ? 'default' : 'pointer',
                opacity: note.trim() === '' ? 0.6 : 1,
              }}
            >
              {busy ? 'Working…' : 'Confirm rejection'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setMode('idle'); setNote('') }}
              style={{
                padding: '10px 20px',
                backgroundColor: 'transparent',
                color: colours.textSecondary,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
