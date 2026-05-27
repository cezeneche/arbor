import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { computeRecordHash } from '@/lib/calculation/audit-chain'
import type { AuditPayload } from '@/lib/calculation/audit-chain'
import type { Prisma } from '@prisma/client'

const bodySchema = z.object({
  domain: z.enum(['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']),
  fieldName: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  scope3Category: z.number().int().min(1).max(15).optional(),
  sourceText: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const lastAuditEntry = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
  })

  const auditPayload: AuditPayload = {
    recordId: `pending_${Date.now()}`,
    entityId,
    domain: parsed.data.domain,
    fieldName: parsed.data.fieldName,
    value: parsed.data.value,
    unit: parsed.data.unit,
    trustTier: 'B',
    submittedAt: new Date().toISOString(),
    submittedById: session.user!.id!,
  }

  const hash = computeRecordHash(auditPayload, lastAuditEntry?.hash ?? null)

  const record = await prisma.dataRecord.create({
    data: {
      entityId,
      domain: parsed.data.domain,
      scope3Category: parsed.data.scope3Category ?? null,
      fieldName: parsed.data.fieldName,
      value: parsed.data.value,
      unit: parsed.data.unit,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      sourceText: parsed.data.sourceText,
      trustTier: 'B',
      extractionMethod: 'MANUAL_ENTRY',
      submittedById: session.user!.id!,
      auditHash: hash,
      isActive: true,
    },
  })

  auditPayload.recordId = record.id
  const finalHash = computeRecordHash(auditPayload, lastAuditEntry?.hash ?? null)

  await prisma.auditEntry.create({
    data: {
      entityId,
      recordId: record.id,
      eventType: 'CREATED',
      payload: auditPayload as unknown as Prisma.InputJsonValue,
      hash: finalHash,
      previousHash: lastAuditEntry?.hash ?? null,
    },
  })

  return ok({ recordId: record.id, trustTier: 'B' }, 201)
}
