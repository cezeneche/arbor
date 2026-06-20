import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

const navLink = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  textDecoration: 'none',
  letterSpacing: typography.tracking.normal,
}

export function PublicNav() {
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: colours.surface,
        borderBottom: `1px solid ${colours.border}`,
        height: '64px',
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
        {/* Wordmark */}
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

        {/* Centre links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <Link href="/how-it-works" style={navLink}>How it works</Link>
          <Link href="/pricing" style={navLink}>Pricing</Link>
          <Link href="/security" style={navLink}>Security</Link>
          <Link href="/about" style={navLink}>About</Link>
        </div>

        {/* Auth actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link
            href="/login"
            style={{
              ...navLink,
              color: colours.textPrimary,
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
