import { colours, typography, spacing } from '@/lib/design-system'
import type { RecordQualitySummary as Summary } from '@/lib/layer3/record-quality'

// A calm, one-line read of the data you already hold — folded into Records so
// "see what I have" and "how good is it" live in one place. Plain English only,
// so it reads the same for an SME supplier and a buyer.

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'good' | 'warn' | 'neutral' }) {
  const colour = tone === 'good' ? colours.green : tone === 'warn' ? colours.amber : colours.textSecondary
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      <span
        style={{
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.medium,
          color: tone === 'neutral' ? colours.textPrimary : colour,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toLocaleString()}
      </span>
      <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
        {label}
      </span>
    </div>
  )
}

export function RecordQualitySummary({ summary }: { summary: Summary }) {
  if (summary.total === 0) return null

  const divider = <div style={{ width: '1px', alignSelf: 'stretch', backgroundColor: colours.border }} />

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing[3],
        padding: `${spacing[2]} ${spacing[3]}`,
        marginBottom: spacing[4],
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
      }}
    >
      <Stat label="Verified" value={summary.verified} tone="good" />
      <Stat label="Declared" value={summary.declared} tone={summary.declared > 0 ? 'warn' : 'neutral'} />
      <Stat label="Estimated" value={summary.estimated} />
      {(summary.missingCompulsoryFields > 0 || summary.expiringSoon > 0) && divider}
      {summary.missingCompulsoryFields > 0 && (
        <Stat label="missing compulsory" value={summary.missingCompulsoryFields} tone="warn" />
      )}
      {summary.expiringSoon > 0 && (
        <Stat label="expiring soon" value={summary.expiringSoon} tone="warn" />
      )}
    </div>
  )
}
