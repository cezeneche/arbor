'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

const cardStyle = {
  backgroundColor: colours.surface,
  border: `1px solid ${colours.border}`,
  borderRadius: '8px',
  padding: spacing[6],
  width: '100%',
  maxWidth: '400px',
}

const labelStyle = {
  display: 'block',
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  marginBottom: '6px',
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  backgroundColor: colours.surface,
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  outline: 'none',
  letterSpacing: '0.2em',
  textAlign: 'center' as const,
}

export default function TwoFactorVerifyPage() {
  const { update } = useSession()

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/auth/2fa/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        showRecovery
          ? { code: recoveryCode, isRecovery: true }
          : { code: code.replace(/\s/g, ''), isRecovery: false },
      ),
    }).catch(() => null)

    setLoading(false)

    const data = await res?.json().catch(() => null)

    if (res?.ok) {
      // Upgrade the JWT by replaying the server-issued nonce. The jwt callback
      // consumes it and rewrites the token with full user data; without a valid
      // nonce the session stays pending2fa.
      await update({ totpVerifiedNonce: data?.nonce })
      // Hard navigation so the middleware sees the upgraded session cookie. A soft
      // router.push() races the cookie write and gets bounced back to /2fa-verify.
      window.location.href = '/dashboard'
      return
    }

    // If the challenge was already completed (e.g. a double submit after success),
    // the user is in fact verified — proceed to the dashboard instead of erroring.
    if (res?.status === 400 && data?.error === 'No 2FA challenge is active.') {
      window.location.href = '/dashboard'
      return
    }
    setError(data?.error ?? 'Something went wrong. Try again.')
  }

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          {showRecovery ? 'Use a recovery code' : 'Two-factor verification'}
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          {showRecovery
            ? 'Enter one of your saved recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
        {showRecovery ? (
          <div>
            <label htmlFor="recovery" style={labelStyle}>
              Recovery code
            </label>
            <input
              id="recovery"
              type="text"
              value={recoveryCode}
              onChange={e => setRecoveryCode(e.target.value)}
              required
              placeholder="xxxxxxxx-xxxxxxxx"
              style={{ ...inputStyle, letterSpacing: '0.05em', textAlign: 'left' }}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="code" style={labelStyle}>
              Authenticator code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              required
              placeholder="000000"
              style={inputStyle}
            />
          </div>
        )}

        {error && (
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.red,
              backgroundColor: colours.redBg,
              padding: '10px 12px',
              borderRadius: '4px',
              margin: 0,
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: spacing[1],
            padding: '12px',
            backgroundColor: loading ? colours.navyHover : colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            letterSpacing: typography.tracking.wide,
          }}
        >
          {loading ? 'Verifying…' : 'Verify'}
        </button>
      </form>

      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          textAlign: 'center',
          margin: `${spacing[2]} 0 0`,
        }}
      >
        <button
          onClick={() => { setShowRecovery(r => !r); setError(null) }}
          style={{
            background: 'none',
            border: 'none',
            color: colours.navy,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {showRecovery ? 'Use authenticator app instead' : "Can't access your app? Use a recovery code"}
        </button>
      </p>

      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          textAlign: 'center',
          margin: `${spacing[1]} 0 0`,
        }}
      >
        <Link
          href="/login"
          style={{ color: colours.navy, textDecoration: 'none', fontWeight: typography.weights.medium }}
        >
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
