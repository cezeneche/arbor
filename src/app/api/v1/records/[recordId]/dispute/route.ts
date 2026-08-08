import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { logRecordAccess } from '@/lib/layer3/grant-access'
import { GRANT_SCOPE_SELECT, anyGrantCoversRecord, toGrantScope } from '@/lib/layer3/grant-scope'
import { buildBuyerLabel } from '@/lib/confidence/buyer-signal'
import { sendNotification } from '@/lib/notifications'
import { stampFlagOwnership } from '@/lib/stewardship/route-flags'
import type { DataDomain, GroundTruthSource, Prisma } from '@prisma/client'

// Buyer-side learning signal. A buyer with an active grant on a shared record can
// confirm it looks right or dispute it as wrong. Either is captured as a
// buyer-sourced GroundTruthLabel; a dispute additionally raises a non-blocking
// flag on the record and notifies the supplier (the correction prompt).
//
// The certified record is NEVER mutated and the audit chain is never touched —
// the label / flag / notification are ancillary. If the supplier agrees, they
// correct the record through the normal supersession flow.

const bodySchema = z.object({
  decision: z.enum(['confirm', 'dispute']),
  suggestedValue: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const auth = await authenticateApiKeyRequest(req)
  if (!auth.authorized || !auth.entityId) {
    return NextResponse.json({ error: auth.reason ?? 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  // Creating a label / flag / notification is a write action.
  if (auth.scope !== 'READ_WRITE') {
    return NextResponse.json({ error: 'This API key is read-only', code: 'FORBIDDEN' }, { status: 403 })
  }
  const buyerEntityId = auth.entityId
  const { recordId } = await params

  const { allowed } = await checkRateLimit(RATE_LIMITS.buyerApi, buyerEntityId)
  if (!allowed) return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const { decision, suggestedValue, note } = parsed.data

  const record = await prisma.dataRecord.findUnique({
    where: { id: recordId },
    include: {
      document: {
        select: {
          documentType: true,
          extractionJobs: {
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: { documentClass: true, extractorVersion: true },
          },
        },
      },
    },
  })
  if (!record || !record.isActive) {
    return NextResponse.json({ error: 'Record not found', code: 'NOT_FOUND' }, { status: 404 })
  }
  // The data owner corrects their own data through review, not the dispute path.
  if (record.entityId === buyerEntityId) {
    return NextResponse.json({ error: 'Use your own review flow to correct your data', code: 'SELF_DISPUTE' }, { status: 400 })
  }

  // Authorise: an active grant from the supplier to this buyer must cover the record.
  const grants = await prisma.dataAccessGrant.findMany({
    where: { grantorEntityId: record.entityId, granteeEntityId: buyerEntityId, isActive: true, revokedAt: null },
    select: GRANT_SCOPE_SELECT,
  })
  const covered = anyGrantCoversRecord(grants.map(toGrantScope), {
    domain: record.domain,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    fieldName: record.fieldName,
  })
  if (!covered) {
    return NextResponse.json({ error: 'No active grant covers this record', code: 'FORBIDDEN' }, { status: 403 })
  }

  const job = record.document?.extractionJobs[0]
  const documentClass = job?.documentClass ?? record.document?.documentType ?? 'UNKNOWN'
  const label = buildBuyerLabel({
    entityId: record.entityId,
    documentId: record.documentId,
    recordId: record.id,
    fieldName: record.fieldName,
    documentClass,
    domain: record.domain,
    recordValue: String(record.originalValue ?? record.value),
    suggestedValue: suggestedValue ?? null,
    confidenceAtExtraction: record.confidenceScore,
    extractorVersion: job?.extractorVersion ?? null,
    decision,
  })

  const created = await prisma.groundTruthLabel.create({
    data: {
      entityId: label.entityId,
      documentId: label.documentId,
      recordId: label.recordId,
      fieldName: label.fieldName,
      documentClass: label.documentClass,
      domain: label.domain as DataDomain,
      extractedValue: label.extractedValue,
      confirmedValue: label.confirmedValue,
      wasCorrect: label.wasCorrect,
      confidenceAtExtraction: label.confidenceAtExtraction,
      source: label.source as GroundTruthSource,
      expectedInformationGain: label.expectedInformationGain,
      lowInformation: label.lowInformation,
      extractorVersion: label.extractorVersion,
    },
    select: { id: true },
  })

  if (decision === 'dispute') {
    // A disputed record is routed to whoever stewards that domain for the
    // supplier, with a deadline, rather than landing in an unowned queue.
    const [owned] = await stampFlagOwnership(
      [
        {
          dataRecordId: record.id,
          flagType: 'BUYER_DISPUTED' as const,
          severity: 'WARNING' as const,
          message:
            `A buyer disputes this value` +
            (suggestedValue ? ` (suggested: ${suggestedValue})` : '') +
            (note ? ` — ${note}` : ''),
        },
      ],
      record.entityId,
    )
    await prisma.validationFlag.create({
      data: owned satisfies Prisma.ValidationFlagUncheckedCreateInput,
    })
    await sendNotification({
      entityId: record.entityId,
      type: 'BUYER_DISPUTE_RAISED',
      payload: {
        recordId: record.id,
        fieldName: record.fieldName,
        buyerEntityId,
        suggestedValue: suggestedValue ?? null,
        note: note ?? null,
      },
    })
  }

  await logRecordAccess([record.id], buyerEntityId, 'API')

  return NextResponse.json({ status: 'ok', recordId: record.id, decision, labelId: created.id })
}
