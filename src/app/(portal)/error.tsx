'use client'

import { useEffect } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

// Portal-level boundary — renders inside the portal shell (nav stays up), so a
// failure on one screen doesn't take down the whole session.
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[portal-error-boundary]', error)
  }, [error])

  return (
    <div
      style={{
        padding: spacing[6],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          textAlign: 'center',
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[4],
        }}
      >
        <h2
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            letterSpacing: typography.tracking.tight,
            margin: `0 0 ${spacing[1]}`,
          }}
        >
          This screen hit a problem
        </h2>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            lineHeight: '1.6',
            margin: `0 0 ${spacing[2]}`,
          }}
        >
          Your records are safe — nothing has been changed. Try again, or move to
          another section and come back.
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
            padding: '9px 18px',
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
    </div>
  )
}
