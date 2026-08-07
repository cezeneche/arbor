import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'
import type { AttentionItem } from '@/lib/layer3/overview-attention'

// §4. Three states, one position. The block never renders empty and is never
// silently absent, because absence is ambiguous: a manager looking at nothing
// cannot tell whether it means all clear or never checked.
//
// Red appears here and on missing coverage cells, nowhere else on the page.

const label = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  display: 'block',
  marginBottom: spacing[1],
}

function ItemRow({ item, tone }: { item: AttentionItem; tone: 'blocking' | 'attention' }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: spacing[3],
        padding: `10px 0`,
        borderBottom: `0.5px solid ${colours.border}`,
      }}
    >
      <span
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textPrimary,
          lineHeight: typography.lineHeight.body,
        }}
      >
        {tone === 'blocking' && (
          <span aria-hidden style={{ color: colours.red, marginRight: '8px' }}>●</span>
        )}
        {item.sentence}
      </span>
      <Link
        href={item.href}
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: colours.navy,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {item.actionLabel}
      </Link>
    </div>
  )
}

export function AttentionBlock({
  heading,
  items,
  tone,
}: {
  heading: string
  items: AttentionItem[]
  tone: 'blocking' | 'attention'
}) {
  // Never a heading with nothing beneath it.
  if (items.length === 0) return null

  return (
    <section style={{ marginBottom: spacing[5] }}>
      <span style={{ ...label, color: tone === 'blocking' ? colours.red : colours.textTertiary }}>
        {heading}
      </span>
      <div
        style={
          tone === 'blocking'
            ? {
                backgroundColor: colours.redBg,
                borderLeft: `2px solid ${colours.red}`,
                padding: `2px ${spacing[2]} 0`,
              }
            : { borderTop: `0.5px solid ${colours.border}` }
        }
      >
        {items.map(item => (
          <ItemRow key={item.key} item={item} tone={tone} />
        ))}
      </div>
    </section>
  )
}

/** The clear state: one quiet line, same position, one line tall. */
export function AttentionClear({ line }: { line: string }) {
  return (
    <section style={{ marginBottom: spacing[5] }}>
      <span style={{ ...label, color: colours.textTertiary }}>Status</span>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: 0,
          paddingTop: '10px',
          borderTop: `0.5px solid ${colours.border}`,
        }}
      >
        {line}
      </p>
    </section>
  )
}
