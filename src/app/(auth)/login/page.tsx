'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('Invalid email or password.')
    } else {
      router.push('/dashboard')
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
        maxWidth: '400px',
      }}
    >
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          arbor
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Sign in to your account
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
        <div>
          <label
            htmlFor="email"
            style={{
              display: 'block',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textSecondary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            style={{
              display: 'block',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textSecondary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              outline: 'none',
            }}
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
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {/* SSO sign-in. Uses the email entered above to resolve the org. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], margin: `${spacing[3]} 0 ${spacing[2]}` }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: colours.border }} />
        <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>or</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: colours.border }} />
      </div>
      <a
        href={email ? `/api/workos/authorize?email=${encodeURIComponent(email)}` : '#'}
        onClick={(e) => { if (!email) { e.preventDefault(); setError('Enter your work email above, then use SSO.') } }}
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '12px',
          backgroundColor: 'transparent',
          color: colours.navy,
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.medium,
          border: `1px solid ${colours.border}`,
          borderRadius: '4px',
          textDecoration: 'none',
          letterSpacing: typography.tracking.wide,
        }}
      >
        Sign in with your company account
      </a>

      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          textAlign: 'center',
          margin: `${spacing[3]} 0 0`,
        }}
      >
        <Link
          href="/forgot-password"
          style={{ color: colours.navy, textDecoration: 'none', fontWeight: typography.weights.medium }}
        >
          Forgot your password?
        </Link>
      </p>

      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          textAlign: 'center',
          margin: `${spacing[2]} 0 0`,
        }}
      >
        No account?{' '}
        <Link
          href="/signup"
          style={{ color: colours.navy, textDecoration: 'none', fontWeight: typography.weights.medium }}
        >
          Create one
        </Link>
      </p>
    </div>
  )
}
