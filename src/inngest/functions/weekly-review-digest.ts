// Core 4 — weekly review digest. Instead of nagging per document, once a week
// each entity gets a single email: "N values to check — about M minutes", linking
// to the unified /review queue. Entities with nothing outstanding get no email.
import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import { summariseReviewQueue } from '@/lib/review/review-policy'

interface Tally {
  fieldCount: number
  documentCount: number
}

export const weeklyReviewDigestFunction = inngest.createFunction(
  {
    id: 'weekly-review-digest',
    triggers: [{ cron: '0 7 * * 1' }], // Mondays at 07:00 UTC
  },
  async ({ step }) => {
    const tallies = await step.run('tally-flagged-fields', async () => {
      // Documents still awaiting review, with their latest extraction job's
      // unresolved flagged fields.
      const docs = await prisma.document.findMany({
        where: { status: 'REVIEW_REQUIRED' },
        select: {
          entityId: true,
          extractionJobs: {
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: {
              extractedFields: {
                where: { flagged: true, confirmedAt: null },
                select: { id: true },
              },
            },
          },
        },
      })

      const byEntity = new Map<string, Tally>()
      for (const doc of docs) {
        const flagged = doc.extractionJobs[0]?.extractedFields.length ?? 0
        if (flagged === 0) continue
        const t = byEntity.get(doc.entityId) ?? { fieldCount: 0, documentCount: 0 }
        t.fieldCount += flagged
        t.documentCount += 1
        byEntity.set(doc.entityId, t)
      }
      return [...byEntity.entries()].map(([entityId, t]) => ({ entityId, ...t }))
    })

    let notified = 0
    for (const t of tallies) {
      if (t.fieldCount <= 0) continue
      const { estimatedMinutes } = summariseReviewQueue(t.fieldCount)
      await step.run(`notify-${t.entityId}`, async () => {
        await sendNotification({
          entityId: t.entityId,
          type: 'REVIEW_DIGEST',
          payload: {
            fieldCount: t.fieldCount,
            estimatedMinutes,
            documentCount: t.documentCount,
          },
        })
      })
      notified += 1
    }

    return { entitiesNotified: notified }
  },
)
