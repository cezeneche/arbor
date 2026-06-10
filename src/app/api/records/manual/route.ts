import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { domainSchema } from '@/lib/constants'
import { ExtractionMethod, TrustTier } from '@prisma/client'

const bodySchema = z.object({
  domain: domainSchema,
  fieldName: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  sourceText: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const userId = session.user!.id!

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const periodStart = new Date(parsed.data.periodStart)
  const periodEnd = new Date(parsed.data.periodEnd)

  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
    return err('Invalid date values', 'VALIDATION_ERROR', 400)
  }
  if (periodEnd <= periodStart) {
    return err('periodEnd must be after periodStart', 'VALIDATION_ERROR', 400)
  }

  const { recordId } = await prisma.$transaction(
    (tx) =>
      writeRecordWithAuditEntry(
        tx,
        {
          entityId,
          domain: parsed.data.domain,
          fieldName: parsed.data.fieldName,
          value: parsed.data.value,
          unit: parsed.data.unit,
          periodStart,
          periodEnd,
          sourceText: parsed.data.sourceText,
          trustTier: TrustTier.B,
          extractionMethod: ExtractionMethod.MANUAL_ENTRY,
          submittedById: userId,
        },
      ),
    { isolationLevel: 'Serializable' },
  )

  return ok({ recordId, trustTier: 'B' }, 201)
}
