/**
 * Nucleos Design System — Token Map
 *
 * Every value references a CSS custom property from styles/tokens.css.
 * Nothing in the UI may use a value not defined here.
 *
 * Rams constraints:
 *   - font.body (300) for all body text, labels, inputs
 *   - font.focal (500) for exactly ONE element per screen — the liability number
 *   - space.* only — no arbitrary values (10px, 12px, 20px forbidden)
 *   - colors.border at 0.5px only — never 1px
 *   - One primary button per screen. Never two.
 */

export const ds = {

  colors: {
    bg:             'var(--color-bg)',
    surface:        'var(--color-surface)',
    navy:           'var(--color-navy)',
    navyHover:      'var(--color-navy-hover)',
    textPrimary:    'var(--color-text-primary)',
    textSecondary:  'var(--color-text-secondary)',
    textTertiary:   'var(--color-text-tertiary)',
    border:         'var(--color-border)',

    green:          'var(--color-green)',
    amber:          'var(--color-amber)',
    red:            'var(--color-red)',
    greenBg:        'var(--color-green-bg)',
    amberBg:        'var(--color-amber-bg)',
    redBg:          'var(--color-red-bg)',
  },

  font: {
    family: 'var(--font-inter)',
    /** 300 — use for all body text, labels, inputs, supporting information */
    body:   'var(--font-body)',
    /** 500 — use for exactly ONE focal element per screen (the liability number) and headings */
    focal:  'var(--font-focal)',
  },

  text: {
    xs:   'var(--text-xs)',    // 11px — timestamps, hashes, tertiary
    sm:   'var(--text-sm)',    // 13px — metadata, badges, secondary
    base: 'var(--text-base)', // 15px — body, inputs, buttons
    lg:   'var(--text-lg)',   // 24px — section headings
    hero: 'var(--text-hero)', // 52px — liability number, once per screen
  },

  leading: {
    body:    'var(--leading-body)',    // 1.6
    display: 'var(--leading-display)', // 1.1
  },

  tracking: {
    hero:    'var(--tracking-hero)',    // -0.03em
    heading: 'var(--tracking-heading)', // -0.01em
    body:    'var(--tracking-body)',    // 0
  },

  /** All spacing values — multiples of 8px only. */
  space: {
    8:  'var(--space-8)',
    16: 'var(--space-16)',
    24: 'var(--space-24)',
    32: 'var(--space-32)',
    40: 'var(--space-40)',
    48: 'var(--space-48)',
    64: 'var(--space-64)',
    80: 'var(--space-80)',
  },

  layout: {
    maxWidth:     'var(--max-width)',       // 960px
    topbarHeight: 'var(--topbar-height)',   // 56px
  },

  component: {
    btnHeight: 'var(--btn-height)',   // 40px
    btnPx:     'var(--btn-px)',       // 24px
    btnRadius: 'var(--btn-radius)',   // 6px

    inputHeight: 'var(--input-height)', // 40px
    inputRadius: 'var(--input-radius)', // 6px

    cardRadius:  'var(--card-radius)',  // 8px
    cardPadding: 'var(--card-padding)', // 32px
    cardShadow:  'var(--card-shadow)',  // elevation: interactive cards only

    badgeRadius: 'var(--badge-radius)', // 4px
    badgePy:     'var(--badge-py)',     // 3px
    badgePx:     'var(--badge-px)',     // 8px

    borderWidth: 'var(--border-width)', // 0.5px
  },

  transition: {
    fast:   'var(--transition-fast)',
    normal: 'var(--transition-normal)',
  },

} as const;

export type DesignSystem = typeof ds;

// ── Status helpers ─────────────────────────────────────────────────────────

export type StatusVariant = 'approved' | 'pending' | 'error' | 'draft';

/**
 * Maps a case/review status string to a badge variant.
 * The badge component uses this to select the correct colour tokens.
 */
export function toStatusVariant(status: string | null | undefined): StatusVariant {
  switch (status) {
    case 'approved':
    case 'signed_off':
    case 'bundled':
    case 'resolved':
    case 'verified':
      return 'approved';

    case 'pending_review':
    case 'narrative_drafted':
    case 'calculated':
    case 'extracted':
    case 'submitted':
      return 'pending';

    case 'error':
    case 'failed':
    case 'rejected':
      return 'error';

    default:
      return 'draft';
  }
}

/** Human-readable label for a case status */
export function statusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = {
    draft:             'Draft',
    submitted:         'Submitted',
    extracted:         'Extracted',
    calculated:        'Calculated',
    resolved:          'Resolved',
    bundled:           'Bundled',
    narrative_drafted: 'Ready for review',
    signed_off:        'Signed off',
    pending_review:    'Pending review',
    approved:          'Approved',
    rejected:          'Rejected',
    error:             'Error',
  };
  return status ? (map[status] ?? status) : '—';
}

/** Human-readable label for an emissions method */
export function methodLabel(method: string | null | undefined): string {
  const map: Record<string, string> = {
    actual_verified:   'Actual (verified)',
    actual_unverified: 'Actual (unverified)',
    actual:            'Actual (verified)',   // backward-compat alias
    estimated:         'Estimated',
    default:           'Default value',
  };
  return method ? (map[method] ?? method) : '—';
}

/** Maps an emissions method string to its badge variant. */
export function methodBadgeVariant(method: string | null | undefined): StatusVariant {
  switch (method) {
    case 'actual_verified':
    case 'actual':
      return 'approved';
    case 'actual_unverified':
    case 'estimated':
      return 'pending';
    case 'default':
      return 'error';
    default:
      return 'draft';
  }
}

/** Format a quarter period as a readable string */
export function periodLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/** Format kg CO2e as tCO2e with two decimal places */
export function formatTco2e(kgco2e: number): string {
  const t = kgco2e / 1000;
  return `${t.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tCO₂e`;
}

/** Format a GBP amount — "£1,234.56" always 2 decimal places. */
export function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style:                 'currency',
    currency:              'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Canonical currency formatter per global spec — alias for formatGbp. */
export const formatCurrency = formatGbp;

/** Format kg CO₂e as tCO₂e — "1.234 tCO₂e" always 3 decimal places. */
export function formatEmissions(kgco2e: number): string {
  const t = kgco2e / 1000;
  return `${t.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tCO₂e`;
}

/** Format a weight — "500.0 t" if ≥ 1 000 kg, else "500 kg". */
export function formatWeight(kg: number): string {
  if (kg >= 1_000) {
    return `${(kg / 1_000).toLocaleString('en-GB', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} t`;
  }
  return `${kg.toLocaleString('en-GB', { maximumFractionDigits: 0 })} kg`;
}

/** Format an ISO date string — "15 March 2027". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  });
}

/** Normalise a CN code to 8 digits, no spaces — "7208 1000" → "72081000". */
export function formatCNCode(code: string): string {
  return code.replace(/\s/g, '').padStart(8, '0');
}
