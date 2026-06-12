import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { ExtractionReview } from '@/components/ExtractionReview'
import { ExtractionPoller } from '@/components/ExtractionPoller'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'

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

  // Cross-validation: look up existing records for the same domain+period
  // to surface conflicts before the user confirms (PRD §12.3).
  const domain = DOMAIN_BY_DOCUMENT_TYPE[document.documentType] ?? 'COMPLIANCE'
  const fields = job?.extractedFields ?? []
  const periodStartRaw = fields.find(f => f.fieldName === 'period_start' || f.fieldName === 'production_period_start')?.rawValue
  const periodEndRaw = fields.find(f => f.fieldName === 'period_end' || f.fieldName === 'production_period_end')?.rawValue

  type ConflictRecord = { fieldName: string; value: number; unit: string; trustTier: string; periodStart: Date; periodEnd: Date }
  let existingConflicts: ConflictRecord[] = []
  if (periodStartRaw && periodEndRaw) {
    try {
      const ps = new Date(periodStartRaw)
      const pe = new Date(periodEndRaw)
      if (!isNaN(ps.getTime()) && !isNaN(pe.getTime())) {
        existingConflicts = await prisma.dataRecord.findMany({
          where: {
            entityId,
            domain: domain as never,
            isActive: true,
            documentId: { not: document.id },
            periodStart: { lte: pe },
            periodEnd: { gte: ps },
          },
          select: { fieldName: true, value: true, unit: true, trustTier: true, periodStart: true, periodEnd: true },
          orderBy: { fieldName: 'asc' },
        })
      }
    } catch { /* date parse failure  -  skip */ }
  }

  const serialisedConflicts = existingConflicts.map(c => ({
    ...c,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
  }))

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
        <ExtractionPoller documentId={document.id} />
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
            existingConflicts={serialisedConflicts}
          />
        </div>
      )}
    </div>
  )
}
