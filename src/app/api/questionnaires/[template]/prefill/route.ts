import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getTemplate } from '@/lib/questionnaires/templates'
import { toPrefillRecords } from '@/lib/questionnaires/load'
import { prefillQuestionnaire } from '@/lib/questionnaires/prefill'

// Layer 3 — read-only. Loads the entity's active records for the period, presents
// them in each question's target unit, and runs the pure pre-fill. No writes, no
// AI, no emission factors — assembly and formatting only.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ template: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { template: templateId } = await params

  const template = getTemplate(templateId)
  if (!template) return err(`Questionnaire '${templateId}' not found`, 'NOT_FOUND', 404)
  if (template.status !== 'available') {
    return err(`Questionnaire '${templateId}' is not yet available for pre-fill`, 'NOT_AVAILABLE', 409)
  }

  const sp = req.nextUrl.searchParams
  const periodStartParam = sp.get('periodStart')
  const periodEndParam = sp.get('periodEnd')

  let periodStart: Date | undefined
  let periodEnd: Date | undefined
  if (periodStartParam) {
    periodStart = new Date(periodStartParam)
    if (isNaN(periodStart.getTime())) return err('Invalid periodStart', 'VALIDATION_ERROR', 400)
  }
  if (periodEndParam) {
    periodEnd = new Date(periodEndParam)
    if (isNaN(periodEnd.getTime())) return err('Invalid periodEnd', 'VALIDATION_ERROR', 400)
  }

  const stored = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
      ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
    },
    select: {
      id: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      trustTier: true,
      periodStart: true,
      periodEnd: true,
    },
  })

  const records = toPrefillRecords(template, stored)
  const answers = prefillQuestionnaire(template, records)

  const answeredCount = answers.filter((a) => a.status === 'answered').length
  const gapCount = answers.filter((a) => a.status === 'gap').length

  return ok({
    template: {
      id: template.id,
      name: template.name,
      framework: template.framework,
      description: template.description,
    },
    period: {
      start: periodStart?.toISOString() ?? null,
      end: periodEnd?.toISOString() ?? null,
    },
    summary: { total: answers.length, answered: answeredCount, gaps: gapCount },
    answers,
  })
}
