import { trustTierConfig, typography } from '@/lib/design-system'
import { tierLabel } from '@/lib/tier-label'

// `plain` (supplier view) shows only the plain-English label - no A/B/C code and
// no technical tooltip. Buyers get the full technical form. Defaults to full
// detail so buyer-facing screens stay unchanged.
export function TierBadge({ tier, plain = false }: { tier: 'A' | 'B' | 'C'; plain?: boolean }) {
  const config = trustTierConfig[tier]
  return (
    <span
      title={plain ? undefined : config.description}
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
      {tierLabel(tier, { plain })}
    </span>
  )
}
