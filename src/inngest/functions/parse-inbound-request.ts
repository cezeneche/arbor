// Parse an inbound data-request email and match it against stored records. We
// NEVER email certified values back to the sender — the sender's address is
// attacker-controlled, so every request is held for the supplier to review and
// send from the portal. Matched answers are stored to make that review one click.
import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { parseDataRequestEmail } from '@/lib/requests/parse-request'
import { matchRequestToRecords, type MatchRecord } from '@/lib/requests/inbound-parse'
import type { Prisma } from '@prisma/client'

export const parseInboundRequestFunction = inngest.createFunction(
  { id: 'parse-inbound-request', retries: 2, concurrency: { limit: 5 }, triggers: [{ event: 'request/inbound' }] },
  async ({ event, step }) => {
    const { entityToken, fromEmail, text } = event.data as {
      entityToken: string
      fromEmail?: string
      text: string
    }

    const entity = await step.run('resolve-entity', async () =>
      prisma.entity.findUnique({ where: { uploadEmailToken: entityToken }, select: { id: true, legalName: true } }),
    )
    if (!entity) return { dropped: true, reason: 'unknown_token' }

    const requestId = await step.run('create-inbound-request', async () => {
      const r = await prisma.inboundRequest.create({
        data: { entityId: entity.id, fromEmail: fromEmail ?? null, rawText: text, status: 'NEW' },
        select: { id: true },
      })
      return r.id
    })

    const parsed = await step.run('parse-with-ai', async () => parseDataRequestEmail(text))

    if (!parsed) {
      await step.run('mark-needs-data-unparsed', async () => {
        await prisma.inboundRequest.update({
          where: { id: requestId },
          data: { status: 'NEEDS_DATA', parsedFields: { reason: 'could_not_parse' } as Prisma.InputJsonValue },
        })
      })
      return { requestId, status: 'NEEDS_DATA', reason: 'unparsed' }
    }

    const match = await step.run('match-records', async () => {
      const records = await prisma.dataRecord.findMany({
        where: {
          entityId: entity.id,
          isActive: true,
          ...(parsed.domain ? { domain: parsed.domain as never } : {}),
        },
        select: { id: true, domain: true, fieldName: true, value: true, unit: true, trustTier: true, periodStart: true, periodEnd: true },
      })
      return matchRequestToRecords(parsed, records as unknown as MatchRecord[])
    })

    if (match.covered) {
      // We have the data, but we do not disclose it automatically. Hold it for the
      // supplier to review and send, storing the matched answers so the portal can
      // show exactly what would be shared. `awaiting: 'supplier_review'` distinguishes
      // this from a genuinely-missing request within the NEEDS_DATA queue.
      await step.run('hold-for-review', async () => {
        await prisma.inboundRequest.update({
          where: { id: requestId },
          data: {
            status: 'NEEDS_DATA',
            parsedFields: { parsed, answers: match.answers, awaiting: 'supplier_review' } as unknown as Prisma.InputJsonValue,
          },
        })
      })
      return { requestId, status: 'NEEDS_DATA', awaiting: 'supplier_review' }
    }

    await step.run('mark-needs-data', async () => {
      await prisma.inboundRequest.update({
        where: { id: requestId },
        data: {
          status: 'NEEDS_DATA',
          parsedFields: { parsed, missingFields: match.missingFields } as unknown as Prisma.InputJsonValue,
        },
      })
    })
    return { requestId, status: 'NEEDS_DATA', missing: match.missingFields }
  },
)
