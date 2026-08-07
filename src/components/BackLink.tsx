'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { colours, spacing, typography } from '@/lib/design-system'
import { parentOf, type ParentLink } from '@/lib/back-links'

// One way home, worded the same on every sub-page. Renders nothing on a
// top-level screen, so it is safe to drop into any page without checking first.
//
// The current screen's own name is shown after the parent, so the user can see
// where they are as well as where "back" goes.

export function BackLink({ current, parent }: { current?: string; parent?: ParentLink }) {
  const pathname = usePathname()
  const target = parent ?? parentOf(pathname ?? '')
  if (!target) return null

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
      <Link href={target.href} style={{ color: colours.navy, textDecoration: 'none' }}>
        ← {target.label}
      </Link>
      {current && (
        <>
          <span aria-hidden style={{ color: colours.textTertiary }}>/</span>
          <span style={{ color: colours.textSecondary }}>{current}</span>
        </>
      )}
    </nav>
  )
}
