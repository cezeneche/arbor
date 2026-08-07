import { colours, typography, spacing } from '@/lib/design-system'

// §7. One stacked bar.
//
// Counts below twenty records, because a percentage derived from three records
// is noise dressed as a metric. Above twenty, both.
//
// The unit-conversion disclaimer lives in the badge tooltip rather than as a
// paragraph: ops managers scan, and an inline grey paragraph is the first thing
// skipped.

const PERCENTAGE_THRESHOLD = 20

const DISCLAIMER =
  'Figures are shown in the unit each record was stored in. arbor never converts between ' +
  'units and never combines record types, so a figure is only ever the sum of like with like. ' +
  'The status shown is the weakest of the records behind it.'

// Density, not hue: verified solid, declared outline, estimated light.
const SEGMENT: Record<string, React.CSSProperties> = {
  verified: { backgroundColor: colours.navy },
  declared: { backgroundColor: `${colours.navy}59` },
  estimated: { backgroundColor: `${colours.navy}1f` },
}

export function ProvenanceBar({
  verified,
  declared,
  estimated,
}: {
  verified: number
  declared: number
  estimated: number
}) {
  const total = verified + declared + estimated
  if (total === 0) return null

  const showPct = total >= PERCENTAGE_THRESHOLD
  const parts = [
    { key: 'verified', label: 'Verified', count: verified },
    { key: 'declared', label: 'Declared', count: declared },
    { key: 'estimated', label: 'Estimated', count: estimated },
  ].filter(p => p.count > 0)

  return (
    <section style={{ marginBottom: spacing[5] }}>
      <span
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          color: colours.textTertiary,
          letterSpacing: typography.tracking.wider,
          textTransform: 'uppercase',
          display: 'block',
          marginBottom: spacing[2],
        }}
        title={DISCLAIMER}
      >
        Provenance
      </span>

      <div style={{ display: 'flex', height: '8px', width: '100%', borderRadius: '2px', overflow: 'hidden' }}>
        {parts.map(p => (
          <div
            key={p.key}
            title={`${p.label}: ${p.count} of ${total}`}
            style={{ ...SEGMENT[p.key], width: `${(p.count / total) * 100}%` }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: spacing[4], marginTop: '10px', flexWrap: 'wrap' }}>
        {parts.map(p => (
          <span
            key={p.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ ...SEGMENT[p.key], display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px' }} />
            {p.label}{' '}
            <span style={{ fontWeight: typography.weights.medium, color: colours.textPrimary }}>
              {showPct ? `${Math.round((p.count / total) * 100)}% · ${p.count}` : p.count}
            </span>
          </span>
        ))}
      </div>
    </section>
  )
}
