import { trustTierConfig } from '@/lib/design-system'

export type Tier = 'A' | 'B' | 'C'

// The plain-English trust label, optionally prefixed with the technical tier code.
// Suppliers see plain English only (no code); buyers get the full technical form.
export function tierLabel(tier: Tier, opts: { plain?: boolean } = {}): string {
  const label = trustTierConfig[tier].label
  return opts.plain ? label : `${tier} · ${label}`
}
