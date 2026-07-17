import { PublicNav } from '@/components/marketing/PublicNav'
import { PublicFooter } from '@/components/marketing/PublicFooter'
import { colours } from '@/lib/design-system'
import './marketing.css'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
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
      <PublicNav />
      <main style={{ flex: 1 }}>{children}</main>
      <PublicFooter />
    </div>
  )
}
