// Nucleos design system — authoritative token export.
// All components import from here; never hardcode hex values, px numbers, or arbitrary strings.


export const brand = {
  /** The wordmark is the name "nucleos" — Inter 300, letter-spacing -0.03em.
   *  Always lowercase. No icon, no mark, no symbol alongside it. */
  name:         'nucleos',
  legalName:    'Nucleos Compliance Ltd',
  category:     'CBAM carbon calculation software',

  /** One-line product description — used in footer, metadata, og:description.
   *  From brand voice rules: plain, specific, no jargon. */
  description:  'nucleos reads your supply chain documents and calculates the carbon price of your imports.',

  /** Copyright — import this, never write the year as a literal string. */
  copyrightYear: 2026,

  /** Wordmark sizes — text rendered at these sizes in UI contexts.
   *  Minimum: 11px. Nav bar: 15px. Auth pages: 20px. */
  wordmark: {
    navPx:    15,
    authPx:   20,
    footerPx: 15,
    minPx:    11,
  },
} as const;

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
    /** 300 — all body text, labels, inputs, supporting information. */
    body:   'var(--font-body)',
    /** 500 — exactly one focal element per screen (the number that matters). */
    focal:  'var(--font-focal)',
  },

  text: {
    /** 11px — timestamps, badge labels, audit hashes, tertiary */
    xs:   'var(--text-xs)',
    /** 13px — secondary body, metadata, back links */
    sm:   'var(--text-sm)',
    /** 15px — primary body, inputs, buttons */
    base: 'var(--text-base)',
    /** 24px — section headings, financial sub-figures */
    lg:   'var(--text-lg)',
    /** 52px — the number that matters most; once per screen maximum */
    hero: 'var(--text-hero)',
  },

  leading: {
    body:    'var(--leading-body)',    // 1.6
    display: 'var(--leading-display)', // 1.1
  },

  tracking: {
    hero:    'var(--tracking-hero)',    // -0.03em — 52px display numbers
    heading: 'var(--tracking-heading)', // -0.01em — 24px headings
    body:    'var(--tracking-body)',    //  0       — all body text
  },

  /** 8px base grid — only these values are permitted. */
  space: {
    8:  'var(--space-8)',
    16: 'var(--space-16)',
    24: 'var(--space-24)',
    32: 'var(--space-32)',
    /** Section separator — always 40px, never 30 or 50. */
    40: 'var(--space-40)',
    48: 'var(--space-48)',
    64: 'var(--space-64)',
    80: 'var(--space-80)',
  },

  layout: {
    maxWidth:     'var(--max-width)',      // 960px — always centred
    topbarHeight: 'var(--topbar-height)',  // 56px
  },

  component: {
    // Buttons
    btnHeight: 'var(--btn-height)',  // 40px
    btnPx:     'var(--btn-px)',      // 24px horizontal padding
    btnRadius: 'var(--btn-radius)',  // 6px

    // Inputs
    inputHeight:     'var(--input-height)',      // 40px
    inputRadius:     'var(--input-radius)',      // 6px
    inputFontSize:   'var(--input-font-size)',   // var(--text-base)
    inputFontWeight: 'var(--input-font-weight)', // var(--font-body)

    // Cards — shadow only on interactive/elevated cards
    cardRadius:  'var(--card-radius)',  // 8px
    cardPadding: 'var(--card-padding)', // 32px
    cardShadow:  'var(--card-shadow)',  // 0 1px 3px rgba(0,0,0,0.06)

    // Badges — NOT pill-shaped; 4px radius; 11px weight 500
    badgeRadius:     'var(--badge-radius)',      // 4px
    badgePy:         'var(--badge-py)',          // 3px
    badgePx:         'var(--badge-px)',          // 8px
    badgeFontSize:   'var(--badge-font-size)',   // var(--text-xs) = 11px
    badgeFontWeight: 'var(--badge-font-weight)', // var(--font-focal) = 500

    // Borders — 0.5px everywhere; never 1px
    borderWidth: 'var(--border-width)', // 0.5px
  },

  transition: {
    fast:   'var(--transition-fast)',   // 120ms ease
    normal: 'var(--transition-normal)', // 200ms ease
  },

} as const;

export type DesignSystem = typeof ds;

export type StatusVariant = 'approved' | 'pending' | 'error' | 'draft';

/**
 * Maps a case/review status string to a badge variant.
 * Drives colour selection in <Badge />; never inlined in components.
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
    case 'processing':
      return 'pending';
    case 'error':
    case 'failed':
    case 'rejected':
      return 'error';
    default:
      return 'draft';
  }
}

/** Human-readable label for a case status. */
export function statusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = {
    draft:             'Processed',
    processing:        'Processing',
    submitted:         'Submitted',
    extracted:         'Processed',
    calculated:        'Processed',
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

/**
 * Human-readable label for an emissions method.
 * Exact strings per global spec — no variations.
 */
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

/**
 * Maps an emissions method string to its badge variant.
 * actual_verified → green, unverified/estimated → amber, default → red.
 */
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

// ── Formatters ────────────────────────────────────────────────────────────────
// Never render raw API numbers directly. Always pass through a formatter.

/** "Q2 2027" */
export function periodLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/**
 * "£1,234.56" — always 2 decimal places, GBP, comma separator.
 * Use for all monetary values.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style:                 'currency',
    currency:              'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Alias — use formatCurrency for all new code. */
export const formatGbp = formatCurrency;

/**
 * "1.234 tCO₂e" — always 3 decimal places.
 * Input is kilograms CO₂e; output is tonnes CO₂e.
 */
export function formatEmissions(kgco2e: number): string {
  const t = kgco2e / 1000;
  return `${t.toLocaleString('en-GB', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} tCO₂e`;
}

/**
 * @deprecated Use formatEmissions() which outputs 3 decimal places per spec.
 *             This function outputs 2dp and will be removed in a future release.
 */
export function formatTco2e(kgco2e: number): string {
  const t = kgco2e / 1000;
  return `${t.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} tCO₂e`;
}

/**
 * "500.0 t" if ≥ 1 000 kg, else "500 kg".
 * Always one decimal place for tonnes; whole numbers for kg.
 */
export function formatWeight(kg: number): string {
  if (kg >= 1_000) {
    return `${(kg / 1_000).toLocaleString('en-GB', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} t`;
  }
  return `${kg.toLocaleString('en-GB', { maximumFractionDigits: 0 })} kg`;
}

/**
 * "15 March 2027" — day month year, no ordinals.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  });
}

/**
 * Normalise a CN code to exactly 8 digits, no spaces.
 * "7208 1000" → "72081000"
 */
export function formatCNCode(code: string): string {
  return code.replace(/\s/g, '').padStart(8, '0');
}
