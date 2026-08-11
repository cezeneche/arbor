import Link from 'next/link'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
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
  matrix = false,
  divider = false,
}: {
  /** Omit when the page heading already names the section. */
  title?: string
  items: RequestItem[]
  emptyText: string
  accent?: boolean
  /**
   * Render as a table rather than cards.
   *
   * Cards are right for a queue you work through one at a time. A history you
   * scan for a particular counterparty or date reads better in columns, where
   * the same field sits in the same place on every row.
   */
  matrix?: boolean
  /** A rule above the section, when it follows other content on the page. */
  divider?: boolean
}) {
  const cell: React.CSSProperties = {
    padding: `${spacing[2]} ${spacing[2]}`,
    textAlign: 'left',
    verticalAlign: 'top',
  }

  return (
    <section
      style={{
        marginBottom: spacing[5],
        ...(divider
          ? { borderTop: `1px solid ${colours.border}`, paddingTop: spacing[4] }
          : {}),
      }}
    >
      {/* The page heading already names the section on every screen that passes
          no title. Repeating it here put "Waiting on you" on the screen twice. */}
      {title && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing[1], marginBottom: spacing[2] }}>
          <p style={textStyles.rowTitle}>{title}</p>
          {items.length > 0 && (
            <span
              style={{
                ...textStyles.caption,
                fontWeight: typography.weights.medium,
                color: accent ? colours.amber : colours.textTertiary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {items.length}
            </span>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p style={textStyles.sectionSubtitle}>
          {emptyText}
        </p>
      ) : matrix ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colours.border}` }}>
                {['Request', 'Kind', 'Detail', 'Sent'].map(h => (
                  <th key={h} style={{ ...cell, ...textStyles.caption }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={`${item.source}-${item.id}`}
                  style={{ borderBottom: `1px solid ${colours.border}` }}
                >
                  <td style={cell}>
                    <Link href={item.href} style={{ ...textStyles.rowTitle, textDecoration: 'none' }}>
                      {item.title}
                    </Link>
                  </td>
                  <td style={{ ...cell, ...textStyles.value }}>{SOURCE_LABELS[item.source]}</td>
                  <td style={{ ...cell, ...textStyles.value }}>{item.detail}</td>
                  <td style={{ ...cell, ...textStyles.value, whiteSpace: 'nowrap' }}>
                    {new Date(item.timestamp).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <p style={{ ...textStyles.caption, margin: '2px 0 0' }}>
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
