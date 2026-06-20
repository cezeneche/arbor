'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

// Gap 5.1 — one "Revoke all access" action per buyer. Inline confirm (no modal).
export function RevokeAllForBuyer({ granteeEntityId, buyerName }: { granteeEntityId: string; buyerName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function revoke() {
    setBusy(true)
    const res = await fetch('/api/grants/revoke-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ granteeEntityId }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{
          padding: '6px 14px',
          backgroundColor: 'transparent',
          color: colours.red,
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          border: `1px solid ${colours.border}`,
          borderRadius: '4px',
          cursor: 'pointer',
          whiteSpace: 'nowrap' as const,
        }}
      >
        Revoke all access
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1] }}>
      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
        Revoke all access for {buyerName}?
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={revoke}
        style={{
          padding: '6px 14px',
          backgroundColor: colours.red,
          color: colours.surface,
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          border: 'none',
          borderRadius: '4px',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Revoking…' : 'Confirm'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(false)}
        style={{
          padding: '6px 14px',
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
    </div>
  )
}
