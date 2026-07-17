'use client'

import { useEffect } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

// Root error boundary — catches any uncaught render/server error below the root
// layout and shows a branded recovery screen instead of Next's raw error page.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface in the browser console / monitoring; the digest links to server logs.
    console.error('[error-boundary]', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: colours.background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing[4],
      }}
    >
      <div style={{ maxWidth: '440px', textAlign: 'center' }}>
        <div
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.navy,
            letterSpacing: typography.tracking.tight,
            marginBottom: spacing[3],
          }}
        >
          arbor
        </div>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            letterSpacing: typography.tracking.tight,
            margin: `0 0 ${spacing[1]}`,
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            lineHeight: '1.6',
            margin: `0 0 ${spacing[3]}`,
          }}
        >
          An unexpected error occurred. Your data is safe — nothing has been
          changed. Try again, or return to the dashboard.
          {error.digest && (
            <span style={{ display: 'block', marginTop: '8px', color: colours.textTertiary, fontSize: typography.sizes.xs }}>
              Reference: {error.digest}
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: spacing[1], justifyContent: 'center' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '10px 20px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            style={{
              padding: '10px 20px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              textDecoration: 'none',
            }}
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
