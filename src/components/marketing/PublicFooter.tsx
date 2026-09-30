import Link from 'next/link'
import { pilotRequestHref } from '@/lib/marketing/pilot'
import { colours, typography } from '@/lib/design-system'

const linkStyle = {
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: 'rgba(255,255,255,0.7)',
  textDecoration: 'none',
  display: 'block',
  marginBottom: '10px',
}

const headingStyle = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: 'rgba(255,255,255,0.7)',
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
      <div className="mk-site-frame">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
              arbor
            </div>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: 'rgba(255,255,255,0.7)',
                lineHeight: '1.6',
                margin: '0 0 12px',
                maxWidth: '260px',
              }}
            >
              Operational data records for manufacturers and their customers.
            </p>
          </div>

          {/* Product */}
          <div>
            <p style={headingStyle}>Product</p>
            <Link href="/how-it-works" style={linkStyle}>How it works</Link>
            <Link href="/pricing" style={linkStyle}>Pricing</Link>
            <Link href="/about" style={linkStyle}>About</Link>
            <Link href="/institutional" style={linkStyle}>Institutional enquiries</Link>
            <Link href="/docs/api" style={linkStyle}>API guide</Link>
            <a href={pilotRequestHref()} style={linkStyle}>Request pilot access</a>
            <Link href="/signup" style={linkStyle}>Create your invited account</Link>
            <Link href="/login" style={linkStyle}>Sign in</Link>
          </div>

          {/* Legal */}
          <div>
            <p style={headingStyle}>Legal</p>
            <Link href="/legal/terms" style={linkStyle}>Terms of service</Link>
            <Link href="/legal/privacy" style={linkStyle}>Privacy policy</Link>
            <Link href="/legal/dpa" style={linkStyle}>Data processing agreement</Link>
            <Link href="/security" style={linkStyle}>Security</Link>
          </div>

          {/* Contact */}
          <div className="mk-footer-contact">
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
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.7)',
              margin: 0,
            }}
          >
            © {year} Arbor
          </p>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.7)',
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
