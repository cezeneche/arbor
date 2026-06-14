import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

export function PublicNav() {
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: colours.surface,
        borderBottom: `1px solid ${colours.border}`,
        height: '56px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '1140px',
          width: '100%',
          margin: '0 auto',
          padding: '0 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.navy,
            textDecoration: 'none',
            letterSpacing: typography.tracking.tight,
          }}
        >
          arbor
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <Link
            href="/pricing"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              textDecoration: 'none',
              letterSpacing: typography.tracking.normal,
            }}
          >
            Pricing
          </Link>
          <Link
            href="/login"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              textDecoration: 'none',
              letterSpacing: typography.tracking.normal,
            }}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: colours.navy,
              textDecoration: 'none',
              padding: '7px 16px',
              borderRadius: '4px',
              letterSpacing: typography.tracking.normal,
            }}
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  )
}
