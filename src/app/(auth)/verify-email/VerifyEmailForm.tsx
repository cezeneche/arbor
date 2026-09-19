'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { colours, spacing, textStyles, typography } from '@/lib/design-system'

// Confirming takes a press, not a page load: mail scanners open links before
// people do, and a link consumed by a scanner would tell the person it had
// already been used.
export default function VerifyEmailForm() {
  const token = useSearchParams().get('token') ?? ''
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function confirm() {
    setState('busy')
    try {
      const res = await fetch('/api/auth/verify-email/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setState('done')
        return
      }
      setMessage(body.error ?? 'This link could not be used.')
      setState('error')
    } catch {
      setMessage('Check your connection and try again.')
      setState('error')
    }
  }

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
        padding: spacing[6],
        width: '100%',
        maxWidth: '420px',
      }}
    >
      <h1 style={textStyles.pageTitle}>Confirm your email address</h1>
      {state === 'done' ? (
        <p style={{ ...textStyles.sectionSubtitle, marginTop: spacing[2] }}>
          Thank you — your email address is confirmed. <a href="/dashboard" style={{ color: colours.textPrimary }}>Go to arbor</a>
        </p>
      ) : (
        <>
          <p style={{ ...textStyles.sectionSubtitle, marginTop: spacing[2] }}>
            Press the button to confirm this is your address.
          </p>
          <button
            type="button"
            onClick={confirm}
            disabled={!token || state === 'busy'}
            style={{
              marginTop: spacing[3],
              padding: '10px 18px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {state === 'busy' ? 'Confirming…' : 'Confirm my email address'}
          </button>
          {!token && (
            <p style={{ ...textStyles.caption, color: colours.red, marginTop: spacing[2] }}>
              This link is incomplete. Open the link from your email again.
            </p>
          )}
          {message && (
            <p style={{ ...textStyles.caption, color: colours.red, marginTop: spacing[2] }}>{message}</p>
          )}
        </>
      )}
    </div>
  )
}
