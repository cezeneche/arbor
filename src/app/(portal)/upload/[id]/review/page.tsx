import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { ExtractionReview } from '@/components/ExtractionReview'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      extractionJobs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        include: {
          extractedFields: {
            orderBy: [
              { admissibility: 'asc' },
              { fieldName: 'asc' },
            ],
          },
        },
      },
    },
  })

  if (!document) notFound()
  if (document.entityId !== entityId) redirect('/dashboard')

  const job = document.extractionJobs[0]

  return (
    <div>
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
          Review extraction
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          {document.fileName} · {document.documentType.replace(/_/g, ' ')}
        </p>
      </div>

      {job?.status === 'QUEUED' || job?.status === 'RUNNING' || !job ? (
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
            padding: spacing[6],
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              color: colours.textSecondary,
              margin: 0,
            }}
          >
            Extracting data from document…
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            This typically takes 10–30 seconds. Refresh this page to check progress.
          </p>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
            padding: spacing[4],
          }}
        >
          <ExtractionReview
            document={{
              id: document.id,
              documentType: document.documentType,
              status: document.status,
              extractionJobs: document.extractionJobs.map(j => ({
                id: j.id,
                status: j.status,
                errorMessage: j.errorMessage,
                extractedFields: j.extractedFields.map(f => ({
                  id: f.id,
                  fieldName: f.fieldName,
                  admissibility: f.admissibility,
                  rawValue: f.rawValue,
                  rawUnit: f.rawUnit,
                  sourceText: f.sourceText,
                  confidenceScore: f.confidenceScore,
                  flagged: f.flagged,
                  flagReason: f.flagReason,
                })),
              })),
            }}
          />
        </div>
      )}
    </div>
  )
}
