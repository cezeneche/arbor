'use client'

import { colours, typography } from '@/lib/design-system'

// Last-resort boundary — catches errors thrown by the root layout itself.
// Must render its own <html>/<body> because the root layout has crashed.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: colours.background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: '440px', textAlign: 'center', padding: '24px' }}>
          <div
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              color: colours.navy,
              marginBottom: '20px',
            }}
          >
            arbor
          </div>
          <h1
            style={{
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              margin: '0 0 8px',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              lineHeight: 1.6,
              margin: '0 0 20px',
            }}
          >
            An unexpected error occurred. Your data is safe.
            {error.digest && (
              <span style={{ display: 'block', marginTop: '8px', color: colours.textTertiary, fontSize: typography.sizes.xs }}>
                Reference: {error.digest}
              </span>
            )}
          </p>
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
        </div>
      </body>
    </html>
  )
}
