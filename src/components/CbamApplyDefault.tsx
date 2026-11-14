'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, controls, spacing, textStyles } from '@/lib/design-system'

// Records the published default on a goods line with no figure. Confirmed
// inline (no dialogs), because the default is higher than a real figure and
// the person should choose it knowing that.

export function CbamApplyDefault({ caseId, goodsLineId }: { caseId: string; goodsLineId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function record() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/cbam/cases/${encodeURIComponent(caseId)}/goods-lines/${encodeURIComponent(goodsLineId)}/default`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'The default could not be recorded.')
        return
      }
      setConfirming(false)
      router.refresh()
    } catch {
      setError('The default could not be recorded. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const small = { ...controls.secondaryButton, padding: '6px 12px' }

  if (!confirming) {
    return (
      <button type="button" style={{ ...small, marginTop: spacing[1] }} onClick={() => setConfirming(true)}>
        Use the published default
      </button>
    )
  }

  return (
    <div style={{ marginTop: spacing[1] }}>
      <p style={{ ...textStyles.caption, color: colours.textSecondary, lineHeight: 1.6, margin: 0 }}>
        This records the published default as this line&apos;s emissions figure. It is higher than a figure
        from the supplier would be, on purpose. If the supplier sends a figure later, theirs replaces it.
      </p>
      <div style={{ display: 'flex', gap: spacing[1], marginTop: spacing[1] }}>
        <button
          type="button"
          style={{ ...controls.primaryButton, padding: '6px 12px', opacity: busy ? 0.6 : 1 }}
          disabled={busy}
          onClick={record}
        >
          {busy ? 'Recording…' : 'Record the default'}
        </button>
        <button type="button" style={small} disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p
          style={{ ...textStyles.caption, color: colours.red, lineHeight: 1.6, margin: `${spacing[1]} 0 0` }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
