import Link from 'next/link'
import { colours, spacing, typography } from '@/lib/design-system'

export function SectionViewNav({
  label,
  active,
  items,
}: {
  label: string
  active: string
  items: { id: string; label: string; href: string }[]
}) {
  return (
    <nav
      aria-label={label}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: spacing[3],
        marginBottom: spacing[4],
        paddingBottom: spacing[2],
        borderBottom: `1px solid ${colours.border}`,
      }}
    >
      {items.map(item => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={active === item.id ? 'page' : undefined}
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: active === item.id ? typography.weights.medium : typography.weights.light,
            color: active === item.id ? colours.textPrimary : colours.textSecondary,
            textDecoration: 'none',
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
