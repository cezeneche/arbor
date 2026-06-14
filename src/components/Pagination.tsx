import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'

const PAGE_SIZE = 20
export { PAGE_SIZE }

export function Pagination({
  page,
  totalPages,
  buildUrl,
}: {
  page: number
  totalPages: number
  buildUrl: (p: number) => string
}) {
  if (totalPages <= 1) return null

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.navy,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    textDecoration: 'none',
    display: 'inline-block',
    letterSpacing: typography.tracking.wide,
  }

  const ghostStyle: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: typography.sizes.xs,
    color: 'transparent',
    display: 'inline-block',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing[3],
      }}
    >
      {page > 1 ? (
        <Link href={buildUrl(page - 1)} style={btnStyle}>← Previous</Link>
      ) : (
        <span style={ghostStyle}>← Previous</span>
      )}

      <span
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.light,
          color: colours.textTertiary,
        }}
      >
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Link href={buildUrl(page + 1)} style={btnStyle}>Next →</Link>
      ) : (
        <span style={ghostStyle}>Next →</span>
      )}
    </div>
  )
}
