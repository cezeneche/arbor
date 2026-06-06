import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { computeRecordHash } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'
import type { Prisma } from '@prisma/client'

const entrySchema = z.object({
  fieldName: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  sourceText: z.string().optional(),
})

const bodySchema = z.object({
  entries: z.array(entrySchema).min(1),
})

// System user sentinel — records written via submission link are attributed to a system account
const SYSTEM_USER_ID = 'system'

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
  if (request.submissionTokenExpiry && request.submissionTokenExpiry < new Date()) {
    return err('This submission link has expired', 'TOKEN_EXPIRED', 410)
  }

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const entityId = request.supplierEntityId

  // Find a real user for this entity to attribute submissions — use first user or fall back to system
  const entityUser = await prisma.user.findFirst({
    where: { entityId },
    select: { id: true },
  })
  const submittedById = entityUser?.id ?? SYSTEM_USER_ID

  const lastAuditEntry = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
  })

  const createdRecordIds: string[] = []

  for (const entry of parsed.data.entries) {
    const auditPayload: AuditPayload = {
      recordId: `pending_${Date.now()}`,
      entityId,
      domain: request.domain,
      fieldName: entry.fieldName,
      value: entry.value,
      unit: entry.unit,
      trustTier: 'B',
      submittedAt: new Date().toISOString(),
      submittedById,
    }

    const hash = computeRecordHash(auditPayload, lastAuditEntry?.hash ?? null)

    const record = await prisma.dataRecord.create({
      data: {
        entityId,
        domain: request.domain,
        fieldName: entry.fieldName,
        value: entry.value,
        unit: entry.unit,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        sourceText: entry.sourceText,
        trustTier: 'B',
        extractionMethod: 'MANUAL_ENTRY',
        submittedById,
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
        eventType: 'CREATED_VIA_SUBMISSION_LINK',
        payload: auditPayload as unknown as Prisma.InputJsonValue,
        hash: finalHash,
        previousHash: lastAuditEntry?.hash ?? null,
      },
    })

    createdRecordIds.push(record.id)
  }

  // Mark request as submitted
  await prisma.dataRequest.update({
    where: { id: request.id },
    data: { status: 'SUBMITTED', respondedAt: new Date() },
  })

  // Grant buyer access to this domain + period so they can query the records
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
