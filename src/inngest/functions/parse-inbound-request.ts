// parse an inbound data-request email, match it against stored records,
// and either auto-answer it or flag it as needing data. Reuses the Gap-8.4 inbound
// email infrastructure; the requests-<token>@ address routes here instead of upload.
import { Resend } from 'resend'
import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { parseDataRequestEmail } from '@/lib/requests/parse-request'
import { matchRequestToRecords, type MatchRecord } from '@/lib/requests/inbound-parse'
import type { Prisma } from '@prisma/client'

let _resend: Resend | null = null
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!_resend) _resend = new Resend(key)
  return _resend
}

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
      await step.run('answer-request', async () => {
        await prisma.inboundRequest.update({
          where: { id: requestId },
          data: {
            status: 'ANSWERED',
            answeredAt: new Date(),
            parsedFields: { parsed, answers: match.answers } as unknown as Prisma.InputJsonValue,
          },
        })
        // Reply with the assembled answer packet, if email delivery is configured.
        const resend = getResend()
        if (resend && fromEmail) {
          await resend.emails
            .send({
              from: 'arbor <onboarding@resend.dev>',
              to: fromEmail,
              subject: `Re: your data request to ${entity.legalName}`,
              html: buildAnswerHtml(entity.legalName, match.answers),
            })
            .catch(() => {})
        }
      })
      return { requestId, status: 'ANSWERED' }
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

function buildAnswerHtml(
  entityName: string,
  answers: { fieldName: string; records: { value: number; unit: string; trustTier: string }[] }[],
): string {
  const rows = answers
    .map((a) => {
      const total = a.records.reduce((s, r) => s + r.value, 0)
      const unit = a.records[0]?.unit ?? ''
      const tier = worstTier(a.records.map((r) => r.trustTier))
      return `<tr><td>${escapeHtml(a.fieldName.replace(/_/g, ' '))}</td><td>${escapeHtml(total)} ${escapeHtml(unit)}</td><td>${escapeHtml(tier)}</td></tr>`
    })
    .join('')
  return `<p>${escapeHtml(entityName)} has answered your data request directly from their certified records.</p>
<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Field</th><th>Value</th><th>Trust tier</th></tr></thead><tbody>${rows}</tbody></table>
<p>Every value above is backed by source documents in Arbor.</p>`
}

function worstTier(tiers: string[]): string {
  const rank: Record<string, number> = { A: 0, B: 1, C: 2 }
  const label: Record<string, string> = { A: 'Verified', B: 'Declared', C: 'Estimated' }
  if (tiers.length === 0) return ''
  const worst = tiers.reduce((w, t) => ((rank[t] ?? 0) > (rank[w] ?? 0) ? t : w), tiers[0])
  return label[worst] ?? worst
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
