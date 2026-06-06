import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { colours, typography, spacing } from '@/lib/design-system'

export default async function BenchmarksPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div style={{ maxWidth: '600px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Sector benchmarks
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Anonymised operational data distributions across sectors.
        </p>
      </div>

      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[5],
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            margin: `0 0 ${spacing[1]}`,
          }}
        >
          Phase 3 — Coming later
        </p>
        <p
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: `0 0 ${spacing[2]}`,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Sector benchmarks are not yet available
        </p>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: 0,
            lineHeight: '1.6',
            maxWidth: '420px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Sector benchmarks will be available once sufficient verified records have been collected
          from multiple businesses in the same sector. They require at least ten companies with
          Tier A data before any figure is shown. This feature is planned for Phase 3.
        </p>
      </div>
    </div>
  )
}
