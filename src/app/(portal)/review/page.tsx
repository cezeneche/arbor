import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { DOMAIN_BY_DOCUMENT_TYPE, DataDomain } from '@/lib/constants'
import { NUMERIC_FIELDS, derivePeriod, summariseReviewQueue } from '@/lib/review/review-policy'
import { ReviewQueue, type ReviewDoc } from '@/components/ReviewQueue'

export default async function ReviewPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const documents = await prisma.document.findMany({
    where: { entityId, status: 'REVIEW_REQUIRED' },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      documentType: true,
      extractionJobs: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { extractedFields: { select: { fieldName: true, rawValue: true, rawUnit: true, flagged: true, flagReason: true, sourceText: true, confidenceScore: true } } },
      },
    },
  })

  let flaggedTotal = 0
  const items: ReviewDoc[] = []
  for (const doc of documents) {
    const fields = doc.extractionJobs[0]?.extractedFields ?? []
    const values: Record<string, string | null> = {}
    for (const f of fields) values[f.fieldName] = f.rawValue
    const { periodStart, periodEnd } = derivePeriod(values)

    const numeric = fields.filter((f) => NUMERIC_FIELDS.has(f.fieldName) && f.rawValue !== null && f.rawValue !== '')
    if (numeric.length === 0) continue

    flaggedTotal += numeric.filter((f) => f.flagged).length

    items.push({
      documentId: doc.id,
      fileName: doc.fileName,
      documentType: doc.documentType,
      domain: (DOMAIN_BY_DOCUMENT_TYPE[doc.documentType] ?? DataDomain.COMPLIANCE) as string,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      fields: numeric.map((f) => ({
        fieldName: f.fieldName,
        value: f.rawValue ?? '',
        unit: f.rawUnit,
        flagged: f.flagged,
        flagReason: f.flagReason,
        sourceText: f.sourceText,
        confidenceScore: f.confidenceScore,
      })),
    })
  }

  const totalFields = items.reduce((n, d) => n + d.fields.length, 0)
  const { estimatedMinutes } = summariseReviewQueue(totalFields)

  return (
    <div style={{ width: '100%' }}>
      <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
        Review
      </h1>
      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 ${spacing[4]}`, maxWidth: '640px' }}>
        {items.length === 0
          ? 'Everything is up to date — nothing needs checking right now.'
          : `${totalFields} value${totalFields === 1 ? '' : 's'} across ${items.length} document${items.length === 1 ? '' : 's'} to check — about ${estimatedMinutes} minute${estimatedMinutes === 1 ? '' : 's'}.${flaggedTotal > 0 ? ` ${flaggedTotal} we weren't sure about are highlighted.` : ''}`}
      </p>

      <ReviewQueue initial={items} />
    </div>
  )
}
