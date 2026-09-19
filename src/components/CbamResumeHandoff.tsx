'use client'

import { useState } from 'react'
import { colours, typography } from '@/lib/design-system'

export interface HandoffState {
  caseId: string | null
  status: string
  problems: string[]
}

// Resume opening the CBAM case for a confirmed document. The figures are
// already saved; this only finishes what did not land in the case, so pressing
// it twice is harmless.

export function CbamResumeHandoff({
  documentId,
  onResult,
}: {
  documentId: string
  onResult: (state: HandoffState) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resume() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/cbam/handoffs/${encodeURIComponent(documentId)}/resume`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'The case could not be resumed. Please try again shortly.')
        return
      }
      onResult(body as HandoffState)
    } catch {
      setError('The case could not be resumed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <button
        type="button"
        onClick={resume}
        disabled={busy}
        style={{
          padding: '7px 16px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: colours.surface,
          backgroundColor: colours.navy,
          border: 'none',
          borderRadius: '4px',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Resuming…' : 'Resume'}
      </button>
      {error && (
        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red }}>
          {error}
        </span>
      )}
    </span>
  )
}
