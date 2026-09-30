// Typography and spacing shared by the legal pages (Privacy Policy, Terms,
// Data Processing Agreement), which each used to keep an identical copy.
import { colours, typography } from '@/lib/design-system'

export const legalContainer = {
  maxWidth: '820px',
  margin: '0 auto',
  padding: '0 clamp(20px, 5vw, 40px)',
}

export const legalH2 = {
  fontSize: '20px',
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.tight,
  margin: '40px 0 12px',
}

export const legalH3 = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.tight,
  margin: '24px 0 8px',
}

export const legalP = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  lineHeight: '1.75',
  margin: '0 0 16px',
}

export const legalLi = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  lineHeight: '1.75',
  marginBottom: '6px',
}
