import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { getCbamCase } from '@/lib/nucleos/cases-client'
import { presentCase } from '@/lib/nucleos/case-presenter'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'

// One case. Read through the boundary; Arbor holds no copy.

export default async function CbamCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  await requirePageSession()
  const { caseId } = await params

  let record: Record<string, unknown> | null = null
  let error: string | null = null
  try {
    record = await getCbamCase(caseId)
  } catch (err) {
    error = (err as Error).message
  }

  const row = record ? presentCase(record as unknown as CbamCaseSummary) : null

  const label = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textTertiary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: '0 0 4px',
  }
  const value = {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    margin: 0,
  }

  return (
    <div>
      <Link
        href="/cbam"
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          textDecoration: 'none',
        }}
      >
        ← CBAM
      </Link>

      <h1 style={{ ...textStyles.pageTitle, marginTop: spacing[2] }}>
        {row?.importer ?? 'CBAM case'}
      </h1>

      {error ? (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.amber,
            marginTop: spacing[3],
          }}
        >
          This case could not be loaded, so nothing below is showing its real state.
          <span style={{ display: 'block', color: colours.textTertiary, marginTop: '4px' }}>
            {error}
          </span>
        </p>
      ) : row ? (
        <>
          <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 ${spacing[5]}` }}>
            {row.period} · {row.sector} · {row.status}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: spacing[3],
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[3],
              backgroundColor: colours.surface,
            }}
          >
            <div>
              <p style={label}>Origin</p>
              <p style={value}>{row.origin}</p>
            </div>
            <div>
              <p style={label}>Net mass</p>
              <p style={value}>{row.mass}</p>
            </div>
            <div>
              <p style={label}>Exposure</p>
              <p style={value}>{row.exposure}</p>
              {row.exposureNote && (
                <p
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.light,
                    color: colours.amber,
                    margin: '4px 0 0',
                  }}
                >
                  {row.exposureNote}
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
