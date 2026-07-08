import Link from 'next/link'
import { colours, spacing, typography } from '@/lib/design-system'

// Breadcrumb shown at the top of every Settings sub-page so the user can see
// where they are and get back to Settings in one click.
export function SettingsBreadcrumb({ current }: { current: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: spacing[3],
        fontSize: typography.sizes.sm,
        fontWeight: typography.weights.light,
      }}
    >
      <Link href="/settings" style={{ color: colours.navy, textDecoration: 'none' }}>
        ← Settings
      </Link>
      <span aria-hidden style={{ color: colours.textTertiary }}>/</span>
      <span style={{ color: colours.textSecondary }}>{current}</span>
    </nav>
  )
}
