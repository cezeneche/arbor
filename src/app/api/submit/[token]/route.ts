import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { ExtractionMethod, TrustTier } from '@prisma/client'

const entrySchema = z.object({
  fieldName: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  sourceText: z.string().optional(),
})

const bodySchema = z.object({
  entries: z.array(entrySchema).min(1),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const request = await prisma.dataRequest.findUnique({
    where: { submissionToken: token },
    include: { buyerEntity: { select: { legalName: true } } },
  })

  if (!request) return err('Invalid or expired submission link', 'NOT_FOUND', 404)

  return NextResponse.json({
    id: request.id,
    buyerName: request.buyerEntity.legalName,
    domain: request.domain,
    periodStart: request.periodStart.toISOString(),
    periodEnd: request.periodEnd.toISOString(),
    requiredFields: request.requiredFields as string[],
    deadline: request.deadline?.toISOString() ?? null,
    notes: request.notes ?? null,
    status: request.status,
    submissionTokenExpiry: request.submissionTokenExpiry?.toISOString() ?? null,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const request = await prisma.dataRequest.findUnique({
    where: { submissionToken: token },
    include: {
      buyerEntity: { select: { id: true, legalName: true } },
      supplierEntity: { select: { id: true, legalName: true } },
    },
  })

  if (!request) return err('Invalid or expired submission link', 'NOT_FOUND', 404)
  if (request.status === 'SUBMITTED' || request.status === 'ACCEPTED') {
    return err('This request has already been responded to', 'ALREADY_RESPONDED', 409)
  }

  // Require an explicit expiry — tokens without one are no longer valid (legacy records).
  if (!request.submissionTokenExpiry || request.submissionTokenExpiry < new Date()) {
    return err('This submission link has expired', 'TOKEN_EXPIRED', 410)
  }

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const entityId = request.supplierEntityId

  // System user is the correct actor for token-based submissions (no authenticated session).
  const systemUser = await getSystemUser(entityId)

  const createdRecordIds: string[] = []

  for (const entry of parsed.data.entries) {
    const { recordId } = await prisma.$transaction(
      (tx) =>
        writeRecordWithAuditEntry(
          tx,
          {
            entityId,
            domain: request.domain,
            fieldName: entry.fieldName,
            value: entry.value,
            unit: entry.unit,
            periodStart: request.periodStart,
            periodEnd: request.periodEnd,
            sourceText: entry.sourceText,
            trustTier: TrustTier.B,
            extractionMethod: ExtractionMethod.MANUAL_ENTRY,
            submittedById: systemUser.id,
          },
          'CREATED_VIA_SUBMISSION_LINK',
        ),
      { isolationLevel: 'Serializable' },
    )
    createdRecordIds.push(recordId)
  }

  await prisma.dataRequest.update({
    where: { id: request.id },
    data: { status: 'SUBMITTED', respondedAt: new Date() },
  })

  // Grant buyer access to this domain + period so they can query the records.
  const existingGrant = await prisma.dataAccessGrant.findFirst({
    where: {
      grantorEntityId: entityId,
      granteeEntityId: request.buyerEntityId,
      domain: request.domain,
      isActive: true,
    },
  })
  if (!existingGrant) {
    await prisma.dataAccessGrant.create({
      data: {
        grantorEntityId: entityId,
        granteeEntityId: request.buyerEntityId,
        domain: request.domain,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        isActive: true,
      },
    })
  }

  return ok({ recordsCreated: createdRecordIds.length, trustTier: 'B' }, 201)
}
