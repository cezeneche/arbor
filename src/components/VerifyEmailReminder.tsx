'use client'

import { useState } from 'react'
import { colours, spacing, typography } from '@/lib/design-system'

// Shown until the account confirms its email address. Sign-in never depends on
// it; it only keeps an unconfirmed address from passing as a confirmed one.
export function VerifyEmailReminder({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle')

  async function resend() {
    setState('busy')
    try {
      const res = await fetch('/api/auth/verify-email/resend', { method: 'POST' })
      setState(res.ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div
      style={{
        border: `1px solid ${colours.border}`,
        borderLeft: `3px solid ${colours.amber}`,
        borderRadius: '6px',
        padding: `${spacing[2]} ${spacing[3]}`,
        marginBottom: spacing[4],
        backgroundColor: colours.amberBg,
        fontSize: typography.sizes.sm,
        fontWeight: typography.weights.light,
        color: colours.textPrimary,
      }}
    >
      Confirm your email address — we sent a link to {email}.{' '}
      {state === 'sent' ? (
        'A new link is on its way.'
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={state === 'busy'}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          {state === 'error' ? 'Try sending it again' : 'Send it again'}
        </button>
      )}
    </div>
  )
}
