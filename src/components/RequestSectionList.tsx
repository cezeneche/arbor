import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'
import type { RequestItem } from '@/lib/layer3/requests-overview'

const SOURCE_LABELS: Record<RequestItem['source'], string> = {
  'data-request': 'Data request',
  'email-request': 'Email',
  'shared-link': 'Shared link',
}

// One section of the unified Requests landing. Each row links into the focused
// screen where the action actually happens, so depth is preserved.
export function RequestSectionList({
  title,
  items,
  emptyText,
  accent = false,
}: {
  title: string
  items: RequestItem[]
  emptyText: string
  accent?: boolean
}) {
  return (
    <section style={{ marginBottom: spacing[5] }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing[1], marginBottom: spacing[2] }}>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            letterSpacing: typography.tracking.normal,
            margin: 0,
          }}
        >
          {title}
        </p>
        {items.length > 0 && (
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: accent ? colours.amber : colours.textTertiary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: 0 }}>
          {emptyText}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.map(item => (
            <Link
              key={`${item.source}-${item.id}`}
              href={item.href}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: spacing[2],
                padding: spacing[2],
                backgroundColor: colours.surface,
                border: `1px solid ${accent ? colours.amber + '55' : colours.border}`,
                borderRadius: '6px',
                textDecoration: 'none',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </p>
                <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, margin: '2px 0 0' }}>
                  {SOURCE_LABELS[item.source]} · {item.detail}
                </p>
              </div>
              <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, flexShrink: 0 }}>→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
