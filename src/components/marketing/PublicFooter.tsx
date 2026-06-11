import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

const linkStyle = {
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: 'rgba(255,255,255,0.5)',
  textDecoration: 'none',
  display: 'block',
  marginBottom: '10px',
}

const headingStyle = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: 'rgba(255,255,255,0.35)',
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  marginBottom: '16px',
}

export function PublicFooter() {
  const year = new Date().getFullYear()

  return (
    <footer
      style={{
        backgroundColor: colours.navy,
        padding: '64px 0 40px',
      }}
    >
      <div
        style={{
          maxWidth: '1140px',
          margin: '0 auto',
          padding: '0 40px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr',
            gap: '48px',
            marginBottom: '48px',
          }}
        >
          {/* Brand */}
          <div>
            <div
              style={{
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                color: '#FFFFFF',
                letterSpacing: typography.tracking.tight,
                marginBottom: '12px',
              }}
            >
              Arbor
            </div>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: 'rgba(255,255,255,0.4)',
                lineHeight: '1.6',
                margin: '0 0 12px',
                maxWidth: '260px',
              }}
            >
              Certified operational data infrastructure for manufacturers, suppliers, and producers.
            </p>
          </div>

          {/* Product */}
          <div>
            <p style={headingStyle}>Product</p>
            <Link href="/pricing" style={linkStyle}>Pricing</Link>
            <Link href="/signup" style={linkStyle}>Get started</Link>
            <Link href="/login" style={linkStyle}>Sign in</Link>
          </div>

          {/* Legal */}
          <div>
            <p style={headingStyle}>Legal</p>
            <Link href="/legal/terms" style={linkStyle}>Terms of service</Link>
            <Link href="/legal/privacy" style={linkStyle}>Privacy policy</Link>
            <Link href="/legal/dpa" style={linkStyle}>Data processing agreement</Link>
          </div>

          {/* Contact */}
          <div>
            <p style={headingStyle}>Contact</p>
            <a href="mailto:hello@arbor.io" style={linkStyle}>hello@arbor.io</a>
            <a href="mailto:legal@arbor.io" style={linkStyle}>legal@arbor.io</a>
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.25)',
              margin: 0,
            }}
          >
            {year} Arbor Data Ltd. All rights reserved. Registered in England and Wales.
          </p>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.25)',
              margin: 0,
            }}
          >
            Operational data infrastructure
          </p>
        </div>
      </div>
    </footer>
  )
}
