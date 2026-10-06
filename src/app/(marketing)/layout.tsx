import { PublicNav } from '@/components/marketing/PublicNav'
import { PublicFooter } from '@/components/marketing/PublicFooter'
import { SkipLink, MAIN_CONTENT_ID } from '@/components/marketing/SkipLink'
import { colours } from '@/lib/design-system'
import './marketing.css'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mk-site"
      style={
        {
          backgroundColor: colours.background,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          // Feed design-system tokens to marketing.css — the stylesheet holds no
          // hardcoded colours of its own.
          '--mk-surface': colours.surface,
          '--mk-border': colours.border,
        } as React.CSSProperties
      }
    >
      <SkipLink />
      <PublicNav />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} style={{ flex: 1 }}>
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
