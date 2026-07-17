import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

const navLink = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  textDecoration: 'none',
  letterSpacing: typography.tracking.normal,
}

const burgerBar = {
  display: 'block',
  width: '18px',
  height: '2px',
  backgroundColor: colours.textPrimary,
  borderRadius: '1px',
}

// Server component. The mobile menu is a CSS-only disclosure (hidden checkbox +
// label) driven by marketing.css — no client JS, no modal, per design rules.
export function PublicNav() {
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backgroundColor: colours.surface,
        borderBottom: `1px solid ${colours.border}`,
        minHeight: '64px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '1140px',
          width: '100%',
          margin: '0 auto',
          padding: '0 clamp(20px, 5vw, 40px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
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

        {/* Mobile menu state — must precede .mk-nav-links for the CSS sibling
            selector. Invisible at every breakpoint. */}
        <input type="checkbox" id="mk-nav-toggle" className="mk-nav-toggle" aria-label="Toggle navigation menu" />

        {/* Centre links: row on desktop, dropdown panel on mobile (marketing.css) */}
        <div className="mk-nav-links">
          <Link href="/how-it-works" style={navLink}>How it works</Link>
          <Link href="/pricing" style={navLink}>Pricing</Link>
          <Link href="/about" style={navLink}>About</Link>
        </div>

        {/* Auth actions + burger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(14px, 3vw, 24px)' }}>
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
          <label htmlFor="mk-nav-toggle" className="mk-nav-burger" aria-label="Open menu">
            <span style={burgerBar} />
            <span style={burgerBar} />
            <span style={burgerBar} />
          </label>
        </div>
      </div>
    </nav>
  )
}
