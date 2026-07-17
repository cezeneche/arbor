'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography } from '@/lib/design-system'

// Approve-and-send for a reviewed inbound request. Inline confirm (no modal):
// first click arms it, second click sends.
export function SendAnswerButton({ requestId, toEmail }: { requestId: string; toEmail: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setSending(true)
    setError(null)
    const res = await fetch(`/api/inbound-requests/${requestId}/send`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (!res?.ok) {
      setError(data?.error ?? 'Could not send. Please try again.')
      setSending(false)
      setArmed(false)
      return
    }
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
      {armed ? (
        <>
          <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            Send these values to {toEmail}?
          </span>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            style={{
              padding: '6px 14px',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: sending ? colours.textTertiary : colours.green,
              border: 'none',
              borderRadius: '4px',
              cursor: sending ? 'default' : 'pointer',
            }}
          >
            {sending ? 'Sending…' : 'Confirm send'}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            disabled={sending}
            style={{
              padding: '6px 12px',
              fontSize: typography.sizes.xs,
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
        </>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          style={{
            padding: '6px 14px',
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.surface,
            backgroundColor: colours.navy,
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Review &amp; send reply
        </button>
      )}
      {error && (
        <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.red }}>
          {error}
        </span>
      )}
    </div>
  )
}
