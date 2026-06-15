import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { runCrossValidation } from '@/lib/validation/cross-validation'
import { ExtractionMethod, TrustTier } from '@prisma/client'
import { normaliseToSI, isSupportedUnit } from '@/lib/layer3/unit-conversion'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'

const fieldSchema = z.object({
  fieldName: z.string(),
  confirmedValue: z.string(),
  confirmedUnit: z.string().optional(),
  domain: z.enum(['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  sourceText: z.string().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
})

const bodySchema = z.object({
  fields: z.array(fieldSchema).min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { id: documentId } = await params

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      extractionJobs: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        include: { extractedFields: true },
      },
    },
  })
  if (!document) return err('Document not found', 'NOT_FOUND', 404)
  if (document.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)
  if (document.status === 'ACCEPTED') return err('Document already confirmed', 'ALREADY_CONFIRMED', 409)

  // Re-derive trust tier server-side from the extraction job, not from the client
  const job = document.extractionJobs[0]
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[document.documentType] ?? []
  const compulsoryFieldNames = new Set(
    fieldDefs.filter((f) => f.admissibility === 'compulsory').map((f) => f.name)
  )

  let trustTier: TrustTier = TrustTier.A
  if (job) {
    const extractedFieldMap = new Map(job.extractedFields.map(f => [f.fieldName, f.rawValue]))
    for (const name of compulsoryFieldNames) {
      const raw = extractedFieldMap.get(name)
      if (raw === null || raw === undefined || raw === '') {
        trustTier = TrustTier.B
        break
      }
    }
  } else {
    // No extraction job — this is a manual confirmation without AI backing
    trustTier = TrustTier.B
  }

  const createdRecords: string[] = []

  for (const field of parsed.data.fields) {
    const rawNum = parseFloat(field.confirmedValue)
    if (isNaN(rawNum)) continue

    const unit = field.confirmedUnit ?? 'unknown'
    const { value: siValue, siUnit } = isSupportedUnit(unit)
      ? normaliseToSI(rawNum, unit)
      : { value: rawNum, siUnit: unit }

    const periodStart = new Date(field.periodStart)
    const periodEnd = new Date(field.periodEnd)

    const { recordId } = await prisma.$transaction(
      async (tx) => {
        // Supersede any existing active records for the same entity+domain+fieldName+period
        const prior = await tx.dataRecord.findMany({
          where: {
            entityId,
            domain: field.domain,
            fieldName: field.fieldName,
            periodStart,
            periodEnd,
            isActive: true,
          },
          select: { id: true },
        })

        const result = await writeRecordWithAuditEntry(
          tx,
          {
            entityId,
            domain: field.domain,
            fieldName: field.fieldName,
            value: siValue,
            unit: siUnit,
            originalValue: rawNum,
            originalUnit: unit,
            periodStart,
            periodEnd,
            trustTier,
            extractionMethod: ExtractionMethod.DOCUMENT_AI,
            submittedById: session.user!.id!,
            documentId,
            sourceText: field.sourceText,
            confidenceScore: field.confidenceScore,
          },
          'CREATED',
        )

        // Mark prior records inactive and point them to the new record
        if (prior.length > 0) {
          await tx.dataRecord.updateMany({
            where: { id: { in: prior.map(p => p.id) } },
            data: { isActive: false, supersededById: result.recordId },
          })
        }

        return result
      },
      { isolationLevel: 'Serializable' },
    )
    createdRecords.push(recordId)
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'ACCEPTED' },
  })

  await runCrossValidation(entityId, documentId, document.documentType)

  return ok({ recordIds: createdRecords, documentStatus: 'ACCEPTED' })
}
