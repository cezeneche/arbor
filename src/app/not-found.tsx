import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'

// Branded 404 for any unmatched route.
export default function NotFound() {
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
          Page not found
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
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            color: colours.surface,
            backgroundColor: colours.navy,
            borderRadius: '4px',
            textDecoration: 'none',
          }}
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
