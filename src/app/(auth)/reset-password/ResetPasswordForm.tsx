'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

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
}

const cardStyle = {
  backgroundColor: colours.surface,
  border: `1px solid ${colours.border}`,
  borderRadius: '8px',
  padding: spacing[6],
  width: '100%',
  maxWidth: '400px',
}

export default function ResetPasswordForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setLoading(true)
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)
    setLoading(false)

    if (res && res.ok) {
      setDone(true)
      setTimeout(() => router.push('/login'), 2000)
    } else {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? 'Something went wrong. Please request a new reset link.')
    }
  }

  if (!token) {
    return (
      <div style={cardStyle}>
        <h1
          style={textStyles.pageTitle}
        >
          Reset link missing
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[2]} 0 ${spacing[3]}` }}
        >
          This page needs a valid reset link. Please request a new one.
        </p>
        <Link
          href="/forgot-password"
          style={{ color: colours.navy, textDecoration: 'none', fontWeight: typography.weights.medium }}
        >
          Request a reset link
        </Link>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          Choose a new password
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Enter a new password for your account.
        </p>
      </div>

      {done ? (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.green,
            backgroundColor: colours.greenBg,
            padding: '12px',
            borderRadius: '4px',
            margin: 0,
          }}
        >
          Your password has been updated. Taking you to sign in…
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
          <div>
            <label htmlFor="password" style={labelStyle}>
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="confirm" style={labelStyle}>
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </div>

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
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      )}
    </div>
  )
}
