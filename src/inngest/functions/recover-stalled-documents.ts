import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { STALLED_AFTER_MINUTES, classifyStalledDocument } from '@/lib/upload/stalled-documents'

// A document only ever leaves PENDING or EXTRACTING because something is working
// on it. When that something never started — the enqueue failed — or died without
// reaching its own failure handler, nothing else moves the row and the user is
// left watching "Reading your document…" indefinitely.
//
// This is the sweeper for exactly that: anything sitting in a working state for
// longer than a run could plausibly take is either re-queued (PENDING, never
// picked up) or marked as needing attention (EXTRACTING, abandoned mid-run). It
// writes no records and changes no tier — it only makes the status honest again.
export const recoverStalledDocumentsFunction = inngest.createFunction(
  { id: 'recover-stalled-documents', triggers: [{ cron: '*/15 * * * *' }] },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - STALLED_AFTER_MINUTES * 60_000)

    const stalled = await step.run('find-stalled-documents', async () =>
      prisma.document.findMany({
        where: { status: { in: ['PENDING', 'EXTRACTING'] }, submittedAt: { lt: cutoff } },
        select: {
          id: true,
          entityId: true,
          documentType: true,
          status: true,
          submittedAt: true,
          entity: { select: { legalName: true } },
          extractionJobs: { select: { id: true, status: true } },
        },
      }),
    )

    let requeued = 0
    let markedForReview = 0

    for (const doc of stalled) {
      const action = classifyStalledDocument({
        status: doc.status,
        hasExtractionJob: doc.extractionJobs.length > 0,
      })

      if (action === 'REQUEUE') {
        await step.sendEvent(`requeue-${doc.id}`, {
          name: 'document/uploaded',
          data: {
            documentId: doc.id,
            entityId: doc.entityId,
            entityName: doc.entity.legalName,
            documentType: doc.documentType,
          },
        })
        requeued++
        continue
      }

      await step.run(`mark-attention-${doc.id}`, async () => {
        await prisma.extractionJob.updateMany({
          where: { documentId: doc.id, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: 'Reading this document stopped before it finished. Try uploading it again.',
          },
        })
        await prisma.document.updateMany({
          where: { id: doc.id, status: { in: ['PENDING', 'EXTRACTING'] } },
          data: { status: 'REVIEW_REQUIRED' },
        })
      })
      markedForReview++
    }

    return { examined: stalled.length, requeued, markedForReview }
  },
)
