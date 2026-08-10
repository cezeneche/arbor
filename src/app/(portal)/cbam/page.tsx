import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { CBAM_VIEWS, resolveCbamView, type CbamView } from '@/lib/nucleos/cbam-views'
import { listCbamCases } from '@/lib/nucleos/cases-client'
import { CbamCaseList } from '@/components/CbamCaseList'

// CBAM is its own section, and its screens are views of it — the same quiet
// toggle Records uses for Trends and Benchmarks. Not tabs: the design rules
// forbid them, and a toggle keeps one primary action per screen.

export default async function CbamPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  await requirePageSession()
  const { view: raw } = await searchParams
  const view: CbamView = resolveCbamView(raw)

  // Read through the boundary rather than from a local copy: cases are Nucleos's
  // domain state and Arbor does not mirror them. A failure is shown as a failure
  // — an empty list would tell an importer they have no declarations to make.
  let cases = null
  let casesError: string | null = null
  if (view === 'cases') {
    try {
      cases = (await listCbamCases()).items
    } catch (err) {
      casesError = (err as Error).message
    }
  }

  const toggleStyle = (active: boolean) => ({
    fontSize: typography.sizes.sm,
    fontWeight: active ? typography.weights.medium : typography.weights.light,
    color: active ? colours.textPrimary : colours.textSecondary,
    textDecoration: 'none',
  })

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>CBAM</h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          Import declarations, embedded emissions and carbon price relief, built on
          the records you have already certified.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: spacing[3],
          marginBottom: spacing[4],
          paddingBottom: spacing[2],
          borderBottom: `1px solid ${colours.border}`,
        }}
      >
        {CBAM_VIEWS.map(v => (
          <Link
            key={v.id}
            href={v.id === 'cases' ? '/cbam' : `/cbam?view=${v.id}`}
            style={toggleStyle(view === v.id)}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div
        style={{
          border: `1px solid ${colours.border}`,
          borderRadius: '6px',
          padding: spacing[4],
          backgroundColor: colours.surface,
        }}
      >
        {view === 'cases' && casesError ? (
          <div
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.amber,
            }}
          >
            CBAM cases could not be loaded, so this list is not showing what you have.
            <div style={{ color: colours.textTertiary, marginTop: '4px' }}>{casesError}</div>
          </div>
        ) : view === 'cases' && cases ? (
          <CbamCaseList cases={cases} />
        ) : (
          <div
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
            }}
          >
            {CBAM_VIEWS.find(v => v.id === view)?.description}
          </div>
        )}
      </div>
    </div>
  )
}
