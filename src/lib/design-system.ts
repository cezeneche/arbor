export const colours = {
  navy: '#1B2F4A',
  navyHover: '#243A5C',
  background: '#F8F8F6',
  surface: '#FFFFFF',
  textPrimary: '#141414',
  textSecondary: '#505050',
  textTertiary: '#6E6E6A',
  border: '#E6E6E2',
  green: '#2A6048',
  greenBg: '#EFF9F4',
  amber: '#8A3C0A',
  amberBg: '#FDF8EE',
  red: '#8F1A1A',
  redBg: '#FDF1F1',
  slate: '#54534C',
  slateBg: '#EFEEE9',
} as const

export const typography = {
  fontFamily: 'Inter, -apple-system, sans-serif',
  weights: { light: 300, medium: 500 } as const,
  sizes: {
    heroXl: '72px',
    hero: '52px',
    lg: '24px',
    base: '15px',
    sm: '13px',
    xs: '11px',
    label: '10px',
  },
  lineHeight: {
    display: '1.1',
    body: '1.6',
  },
  tracking: {
    tight: '-0.03em',    // hero only
    heading: '-0.01em',  // h2, h3 section headings
    normal: '0',         // body
    wide: '0.08em',      // buttons, status labels
    wider: '0.1em',      // eyebrow caps
  },
} as const

// Canonical text hierarchy for the whole product. Every screen should compose its
// headings, labels, and body text from these — spread a style and add only spacing
// (margins) locally. This is the single source of truth for the type scale, so the
// stepped hierarchy (page 24 → section 15 → row 13 → caption 11) stays consistent
// across every page instead of being re-guessed inline. Derived from the layered
// pattern used in the Settings "Administration" card.
export const textStyles = {
  // Page H1 — one per screen (e.g. "Settings").
  pageTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    letterSpacing: typography.tracking.tight,
    margin: 0,
  },
  // The single line of context under a page H1.
  pageSubtitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: 0,
  },
  // Card / section heading (e.g. "Administration", "Your profile").
  sectionTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    letterSpacing: typography.tracking.heading,
    margin: 0,
  },
  // The line of context under a section heading.
  sectionSubtitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: 0,
  },
  // A list-item / setting title inside a card (e.g. "Webhooks").
  rowTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    margin: 0,
  },
  // Supporting description under a row title, or any small helper text.
  caption: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: 0,
  },
  // Uppercase field label above a value (e.g. "NAME", "COUNTRY").
  eyebrow: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase',
    margin: 0,
  },
  // A displayed field value under an eyebrow label (e.g. "Midlands Steel").
  value: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    margin: 0,
  },
} as const

export const spacing = {
  1: '8px',
  2: '16px',
  3: '24px',
  4: '32px',
  5: '40px',
  6: '48px',
  7: '56px',
  8: '64px',
  10: '80px',
} as const

export const trustTierConfig = {
  A: {
    label: 'Verified',
    colour: colours.green,
    bg: colours.greenBg,
    description: 'Extracted from a source document. Source text recorded.',
  },
  B: {
    label: 'Declared',
    colour: colours.amber,
    bg: colours.amberBg,
    description: 'Entered without a source document, or document failed a quality check.',
  },
  C: {
    label: 'Estimated',
    colour: colours.slate,
    bg: colours.slateBg,
    description: 'Published default factor applied. Not actual activity data.',
  },
} as const

export const shadows = {
  dropdown: '0 4px 16px rgba(0,0,0,0.08)',
} as const

export const borders = {
  width: {
    thin: '1px',
    medium: '2px',
  },
  radius: {
    xs: '3px',
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
  },
  style: {
    default: `1px solid ${colours.border}`,
    focus: `1px solid ${colours.navy}`,
    subtle: '1px solid rgba(255,255,255,0.08)',
    activeNav: '2px solid rgba(255,255,255,0.7)',
    inactiveNav: '2px solid transparent',
  },
} as const

export const layout = {
  navWidth: '216px',
  mainPaddingX: '40px',
  mainPaddingY: '40px',
  sectionGap: spacing[3],
  sectionPadding: spacing[3],
  cardBorderRadius: '8px',
  codeBorderRadius: '4px',
} as const

export const confidenceThreshold = 0.85
