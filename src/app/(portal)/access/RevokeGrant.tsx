'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography } from '@/lib/design-system'

export function RevokeGrant({
  grantId,
  buyerName,
  scopeLabel,
}: {
  grantId: string
  buyerName: string
  scopeLabel: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/grants/${grantId}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Could not revoke access. Try again.')
      setLoading(false)
      return
    }
    router.refresh()
  }

  if (confirming) {
    return (
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `0 0 6px`,
          }}
        >
          Revoke access for {buyerName} ({scopeLabel})?
        </p>
        {error && (
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.red,
              margin: `0 0 6px`,
            }}
          >
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setConfirming(false); setError(null) }}
            disabled={loading}
            style={{
              padding: '6px 14px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              backgroundColor: 'transparent',
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleRevoke}
            disabled={loading}
            style={{
              padding: '6px 14px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: loading ? colours.textTertiary : colours.red,
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        flexShrink: 0,
        padding: '6px 14px',
        fontSize: typography.sizes.sm,
        fontWeight: typography.weights.light,
        color: colours.textSecondary,
        backgroundColor: 'transparent',
        border: `1px solid ${colours.border}`,
        borderRadius: '4px',
        cursor: 'pointer',
      }}
    >
      Revoke
    </button>
  )
}
