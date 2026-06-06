import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { computeRecordHash } from '@/lib/layer2/audit-chain'
import { runCrossValidation } from '@/lib/validation/cross-validation'
import type { AuditPayload } from '@/lib/layer2/audit-chain'
import type { Prisma } from '@prisma/client'

const fieldSchema = z.object({
  fieldName: z.string(),
  confirmedValue: z.string(),
  confirmedUnit: z.string().optional(),
  domain: z.enum(['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']),
  normalisedValue: z.number(),
  normalisedUnit: z.string(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
})

const bodySchema = z.object({
  fields: z.array(fieldSchema).min(1),
  trustTier: z.enum(['A', 'B']),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { id: documentId } = await params

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const document = await prisma.document.findUnique({ where: { id: documentId } })
  if (!document) return err('Document not found', 'NOT_FOUND', 404)
  if (document.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const lastAuditEntry = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
  })

  const createdRecords = []

  for (const field of parsed.data.fields) {
    const auditPayload: AuditPayload = {
      recordId: `pending_${Date.now()}_${field.fieldName}`,
      entityId,
      domain: field.domain,
      fieldName: field.fieldName,
      value: field.normalisedValue,
      unit: field.normalisedUnit,
      trustTier: parsed.data.trustTier,
      submittedAt: new Date().toISOString(),
      submittedById: session.user!.id!,
    }

    const hash = computeRecordHash(auditPayload, lastAuditEntry?.hash ?? null)

    const record = await prisma.dataRecord.create({
      data: {
        entityId,
        documentId,
        domain: field.domain,
        fieldName: field.fieldName,
        value: field.normalisedValue,
        unit: field.normalisedUnit,
        originalValue: parseFloat(field.confirmedValue),
        originalUnit: field.confirmedUnit ?? field.normalisedUnit,
        periodStart: new Date(field.periodStart),
        periodEnd: new Date(field.periodEnd),
        trustTier: parsed.data.trustTier,
        extractionMethod: 'DOCUMENT_AI',
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

    createdRecords.push(record.id)
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'ACCEPTED' },
  })

  await runCrossValidation(entityId, documentId, document.documentType)

  return ok({ recordIds: createdRecords, documentStatus: 'ACCEPTED' })
}
