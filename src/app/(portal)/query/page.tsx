import { colours, typography, spacing } from '@/lib/design-system'
import { QueryEngine } from './QueryEngine'

export default function QueryPage() {
  return (
    <div>
      <div style={{ marginBottom: spacing[4] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Query
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Ask a question in plain English. arbor finds the matching records and shows them with their trust tier.
        </p>
      </div>

      <QueryEngine />
    </div>
  )
}
