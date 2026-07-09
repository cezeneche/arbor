import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { runSerializable } from '@/lib/layer2/serializable'
import { ExtractionMethod, TrustTier } from '@prisma/client'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'
import { MAX_BATCH_ENTRIES } from '@/lib/constants'
import { hashOpaqueToken } from '@/lib/tokens/opaque-token'

const entrySchema = z.object({
  fieldName: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  sourceText: z.string().optional(),
})

const bodySchema = z.object({
  entries: z.array(entrySchema).min(1).max(MAX_BATCH_ENTRIES),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.submitToken, ip)
  if (!allowed) return err('Too many requests. Please try again later.', 'RATE_LIMITED', 429)

  const { token } = await params

  const request = await prisma.dataRequest.findUnique({
    where: { submissionTokenHash: hashOpaqueToken(token) },
    include: { buyerEntity: { select: { legalName: true } } },
  })

  if (!request) return err('Invalid or expired submission link', 'NOT_FOUND', 404)

  if (!request.submissionTokenExpiry || request.submissionTokenExpiry < new Date()) {
    return err('This submission link has expired', 'TOKEN_EXPIRED', 410)
  }

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
    submissionTokenExpiry: request.submissionTokenExpiry.toISOString(),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.submitToken, ip)
  if (!allowed) return err('Too many requests. Please try again later.', 'RATE_LIMITED', 429)

  const { token } = await params

  const request = await prisma.dataRequest.findUnique({
    where: { submissionTokenHash: hashOpaqueToken(token) },
    include: {
      buyerEntity: { select: { id: true, legalName: true } },
      supplierEntity: { select: { id: true, legalName: true } },
    },
  })

  if (!request) return err('Invalid or expired submission link', 'NOT_FOUND', 404)
  if (request.status === 'SUBMITTED' || request.status === 'ACCEPTED') {
    return err('This request has already been responded to', 'ALREADY_RESPONDED', 409)
  }
  if (!request.submissionTokenExpiry || request.submissionTokenExpiry < new Date()) {
    return err('This submission link has expired', 'TOKEN_EXPIRED', 410)
  }

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  // Validate field names BEFORE claiming — a bad payload must not brick the request.
  const requiredFields = request.requiredFields as string[]
  if (requiredFields.length > 0) {
    const unknownFields = parsed.data.entries
      .map(e => e.fieldName)
      .filter(name => !requiredFields.includes(name))
    if (unknownFields.length > 0) {
      return err(
        `Unknown field(s): ${unknownFields.join(', ')}. Accepted fields: ${requiredFields.join(', ')}`,
        'UNKNOWN_FIELDS',
        400,
      )
    }
  }

  const entityId = request.supplierEntityId
  const systemUser = await getSystemUser(entityId)

  // One serializable transaction: claim + records + grant.
  // If any step fails the whole thing rolls back — no partial state.
  let recordCount = 0
  try {
    await runSerializable(async (tx) => {
      // Reset per attempt — the wrapper may re-run this whole function on a
      // write-conflict retry, and each run starts the transaction from scratch.
      recordCount = 0
      // Atomic claim — prevents concurrent double-submissions.
      const claimed = await tx.dataRequest.updateMany({
        where: { id: request.id, status: { notIn: ['SUBMITTED', 'ACCEPTED'] } },
        data: { status: 'SUBMITTED', respondedAt: new Date() },
      })
      if (claimed.count === 0) {
        const alreadyDone = new Error('ALREADY_RESPONDED')
        alreadyDone.name = 'ALREADY_RESPONDED'
        throw alreadyDone
      }

      for (const entry of parsed.data.entries) {
        await writeRecordWithAuditEntry(
          tx,
          {
            entityId,
            domain: request.domain,
            fieldName: entry.fieldName,
            value: entry.value,
            unit: entry.unit,
            originalValue: entry.value,
            originalUnit: entry.unit,
            periodStart: request.periodStart,
            periodEnd: request.periodEnd,
            sourceText: entry.sourceText,
            trustTier: TrustTier.B,
            extractionMethod: ExtractionMethod.MANUAL_ENTRY,
            submittedById: systemUser.id,
          },
          'CREATED_VIA_SUBMISSION_LINK',
        )
        recordCount++
      }

      // Grant buyer access to this domain + period.
      const existingGrant = await tx.dataAccessGrant.findFirst({
        where: {
          grantorEntityId: entityId,
          granteeEntityId: request.buyerEntityId,
          domain: request.domain,
          isActive: true,
          AND: [
            { OR: [{ periodStart: null }, { periodStart: { lte: request.periodStart } }] },
            { OR: [{ periodEnd: null }, { periodEnd: { gte: request.periodEnd } }] },
          ],
        },
      })
      if (!existingGrant) {
        await tx.dataAccessGrant.create({
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
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'ALREADY_RESPONDED') {
      return err('This request has already been responded to', 'ALREADY_RESPONDED', 409)
    }
    throw e
  }

  return ok({ recordsCreated: recordCount, trustTier: 'B' }, 201)
}
