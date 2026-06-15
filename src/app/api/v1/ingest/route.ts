// Layer 2 — ERP / accounting system ingest webhook.
// Accepts structured operational data pushed from third-party systems.
// Records are written as Tier B / SYSTEM_INTEGRATION — no source document is attached.
// A source document must be submitted separately to upgrade to Tier A.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import { computeRecordHash } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { domainSchema } from '@/lib/constants'
import { TrustTier, ExtractionMethod } from '@prisma/client'
import type { Prisma } from '@prisma/client'

const recordSchema = z.object({
  domain: domainSchema,
  fieldName: z.string().min(1).max(120),
  value: z.number().finite(),
  unit: z.string().min(1).max(60),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  sourceSystem: z.string().max(120).optional(),
})

const bodySchema = z.object({
  records: z.array(recordSchema).min(1).max(500),
  idempotencyKey: z.string().max(120).optional(),
})

type RecordResult =
  | { index: number; status: 'created'; recordId: string; domain: string; fieldName: string }
  | { index: number; status: 'rejected'; reason: string; domain?: string; fieldName?: string }

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiKey(req.headers.get('authorization'))
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const entityId = authResult.entityId!

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Request body failed validation',
      code: 'VALIDATION_ERROR',
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    }, { status: 400 })
  }

  const { records, idempotencyKey } = parsed.data

  // Idempotency: if this key was already processed, return the previous result.
  if (idempotencyKey) {
    const previous = await prisma.auditEntry.findFirst({
      where: { entityId, eventType: 'INGEST_BATCH', recordId: `batch_${idempotencyKey}` },
    })
    if (previous) {
      return NextResponse.json({ idempotent: true, message: 'This batch was already processed.', batchAuditHash: previous.hash }, { status: 200 })
    }
  }

  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!entity) {
    return NextResponse.json({ error: 'Entity not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const systemUser = await getSystemUser(entityId)
  const results: RecordResult[] = []

  for (let i = 0; i < records.length; i++) {
    const r = records[i]

    if (new Date(r.periodEnd) <= new Date(r.periodStart)) {
      results.push({ index: i, status: 'rejected', reason: 'periodEnd must be after periodStart', domain: r.domain, fieldName: r.fieldName })
      continue
    }

    try {
      // writeRecordWithAuditEntry fetches previousHash inside the Serializable transaction —
      // safe under concurrent requests; second writer will retry on P2034.
      const { recordId } = await prisma.$transaction(
        (tx) =>
          writeRecordWithAuditEntry(tx, {
            entityId,
            domain: r.domain,
            fieldName: r.fieldName,
            value: r.value,
            unit: r.unit,
            periodStart: new Date(r.periodStart),
            periodEnd: new Date(r.periodEnd),
            sourceText: r.sourceSystem,
            trustTier: TrustTier.B,
            extractionMethod: ExtractionMethod.SYSTEM_INTEGRATION,
            submittedById: systemUser.id,
          }),
        { isolationLevel: 'Serializable' },
      )
      results.push({ index: i, status: 'created', recordId, domain: r.domain, fieldName: r.fieldName })
    } catch {
      results.push({ index: i, status: 'rejected', reason: 'Internal error writing record', domain: r.domain, fieldName: r.fieldName })
    }
  }

  const created = results.filter(r => r.status === 'created').length
  const rejected = results.filter(r => r.status === 'rejected').length

  // Batch audit tombstone for idempotency lookups — written after all records are committed.
  if (idempotencyKey && created > 0) {
    const lastEntry = await prisma.auditEntry.findFirst({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    })
    const batchNow = new Date().toISOString()
    const batchPayload: AuditPayload = {
      recordId: `batch_${idempotencyKey}`,
      entityId,
      domain: 'COMPLIANCE',
      fieldName: 'ingest_batch',
      value: created,
      unit: 'records',
      originalValue: created,
      originalUnit: 'records',
      periodStart: batchNow,
      periodEnd: batchNow,
      trustTier: 'B',
      confidenceScore: 1.0,
      sourceText: null,
      documentId: null,
      extractionMethod: 'SYSTEM_INTEGRATION',
      submittedAt: batchNow,
      submittedById: systemUser.id,
    }
    const batchHash = computeRecordHash(batchPayload, lastEntry?.hash ?? null)
    await prisma.auditEntry.create({
      data: {
        entityId,
        recordId: batchPayload.recordId,
        eventType: 'INGEST_BATCH',
        payload: batchPayload as unknown as Prisma.InputJsonValue,
        hash: batchHash,
        previousHash: lastEntry?.hash ?? null,
      },
    }).catch(e => console.error('[ingest] batch audit tombstone failed:', e))
  }

  return NextResponse.json({
    created,
    rejected,
    total: records.length,
    trustTier: 'B',
    note: 'Records created as Declared (Tier B). Submit supporting documents to upgrade to Verified (Tier A).',
    results,
  }, { status: 201 })
}
