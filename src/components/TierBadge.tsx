import { trustTierConfig, typography } from '@/lib/design-system'

export function TierBadge({ tier }: { tier: 'A' | 'B' | 'C' }) {
  const config = trustTierConfig[tier]
  return (
    <span
      title={config.description}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        letterSpacing: typography.tracking.wide,
        color: config.colour,
        backgroundColor: config.bg,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {tier}: {config.label}
    </span>
  )
}
