import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { CBAM_VIEWS, resolveCbamView, type CbamView } from '@/lib/nucleos/cbam-views'
import { listCbamCases } from '@/lib/nucleos/cases-client'
import { CbamCaseList } from '@/components/CbamCaseList'
import { CbamScopeChecker } from '@/components/CbamScopeChecker'
import { CbamStartCase } from '@/components/CbamStartCase'
import { selectReusableDocuments } from '@/lib/nucleos/reusable-documents'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// CBAM is its own section, and its screens are views of it — the same quiet
// toggle Records uses for Trends and Benchmarks. Not tabs: the design rules
// forbid them, and a toggle keeps one primary action per screen.

export default async function CbamPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const session = await requirePageSession()
  const entityId = getSessionUser(session).entityId as string
  const { view: raw } = await searchParams
  const view: CbamView = resolveCbamView(raw)

  // Read through the boundary rather than from a local copy: cases are Nucleos's
  // domain state and Arbor does not mirror them. A failure is shown as a failure
  // — an empty list would tell an importer they have no declarations to make.
  // Documents already in Arbor that could back a case. Offered alongside upload
  // so the same real-world document is never held twice.
  let reusable: ReturnType<typeof selectReusableDocuments> = []
  if (view === 'cases' && entityId) {
    const docs = await prisma.document.findMany({
      where: { entityId },
      orderBy: { submittedAt: 'desc' },
      take: 50,
      select: {
        id: true, fileName: true, documentType: true, status: true, submittedAt: true,
        extractionJobs: { select: { extractorVersion: true }, take: 1, orderBy: { startedAt: 'desc' } },
      },
    })
    reusable = selectReusableDocuments(
      docs.map(d => ({
        id: d.id,
        fileName: d.fileName,
        documentType: d.documentType,
        status: d.status,
        submittedAt: d.submittedAt,
        // The extractor stamp names Nucleos when CBAM extraction ran.
        hasCbamFields: Boolean(d.extractionJobs[0]?.extractorVersion?.includes('nucleos')),
      })),
    )
  }

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
            href={v.id === 'scope' ? '/cbam' : `/cbam?view=${v.id}`}
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
        {view === 'scope' ? (
          <CbamScopeChecker />
        ) : view === 'cases' && casesError ? (
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
          <>
            <CbamStartCase documents={reusable} />
            <CbamCaseList cases={cases} />
          </>
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
