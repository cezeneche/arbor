import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { runSerializable } from '@/lib/layer2/serializable'
import { domainSchema } from '@/lib/constants'
import { assertRecordCapacity } from '@/lib/plan-guard'
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
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
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

  // Counted inside the transaction that writes: counting first and writing after
  // let two requests both see room for the last record and both take it.
  class OverCapacity extends Error {
    constructor(readonly detail: string) { super(detail) }
  }

  let recordId: string
  try {
    ;({ recordId } = await runSerializable(async (tx) => {
    const capacity = await assertRecordCapacity(entityId, 1, tx)
    if (!capacity.allowed) throw new OverCapacity(capacity.reason!)

    return writeRecordWithAuditEntry(
      tx,
      {
        entityId,
        domain: parsed.data.domain,
        fieldName: parsed.data.fieldName,
        value: parsed.data.value,
        unit: parsed.data.unit,
        originalValue: parsed.data.value,
        originalUnit: parsed.data.unit,
        periodStart,
        periodEnd,
        sourceText: parsed.data.sourceText,
        trustTier: TrustTier.B,
        extractionMethod: ExtractionMethod.MANUAL_ENTRY,
        submittedById: userId,
      },
    )
    }))
  } catch (e) {
    if (e instanceof OverCapacity) return err(e.detail, 'PLAN_LIMIT', 402)
    throw e
  }

  return ok({ recordId, trustTier: 'B' }, 201)
}
