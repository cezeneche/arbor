export const colours = {
  navy: '#1B2F4A',
  navyHover: '#243A5C',
  background: '#F8F8F6',
  surface: '#FFFFFF',
  textPrimary: '#141414',
  textSecondary: '#636363',
  textTertiary: '#A0A09A',
  border: '#E6E6E2',
  green: '#2A6048',
  greenBg: '#EFF9F4',
  amber: '#8A3C0A',
  amberBg: '#FDF8EE',
  red: '#8F1A1A',
  redBg: '#FDF1F1',
} as const

export const typography = {
  fontFamily: 'Inter, -apple-system, sans-serif',
  weights: { light: 300, medium: 500 } as const,
  sizes: {
    hero: '52px',
    lg: '24px',
    base: '15px',
    sm: '13px',
    xs: '11px',
    label: '10px',
  },
  tracking: {
    tight: '-0.03em',
    normal: '0',
    wide: '0.08em',
    wider: '0.12em',
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
    label: 'Document-verified',
    colour: colours.green,
    bg: colours.greenBg,
    description: 'Extracted from a source document. Source text recorded.',
  },
  B: {
    label: 'Supplier-declared',
    colour: colours.amber,
    bg: colours.amberBg,
    description: 'Declared by the supplier. No document backing.',
  },
  C: {
    label: 'Default estimate',
    colour: colours.textTertiary,
    bg: colours.background,
    description: 'Published default factor applied. Not actual activity data.',
  },
} as const

export const confidenceThreshold = 0.85
