// Layer 2 — ERP / accounting system ingest webhook.
// Accepts structured operational data pushed from third-party systems.
// Records are written as Tier B / SYSTEM_INTEGRATION — no source document is attached.
// A source document must be submitted separately to upgrade to Tier A.
import { NextRequest, NextResponse } from 'next/server'
import { isStorableUnit } from '@/lib/layer2/canonical-measurement'
import { z } from 'zod'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import {
  claimItem,
  completeIngestOperation,
  releaseIngestOperation,
  requestDigest,
  reserveIngestOperation,
} from '@/lib/layer2/ingest-operation'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { runSerializable } from '@/lib/layer2/serializable'
import { domainSchema } from '@/lib/constants'
import { assertRecordCapacity } from '@/lib/plan-guard'
import { TrustTier, ExtractionMethod } from '@prisma/client'

const recordSchema = z.object({
  domain: domainSchema,
  fieldName: z.string().min(1).max(120),
  value: z.number().finite(),
  unit: z.string().min(1).max(60).refine(isStorableUnit, { message: 'Arbor does not recognise this unit. Use one listed at /api/records/convert/units, or "count" for a figure with no unit.' }),
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
  | { index: number; status: 'rejected'; reason: string; domain?: string; fieldName?: string; retryable?: boolean }

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiKeyRequest(req)
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (authResult.scope !== 'READ_WRITE') {
    return NextResponse.json({ error: 'This API key is read-only', code: 'FORBIDDEN' }, { status: 403 })
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

  // Reserve the key before anything is written. A completed batch replays its
  // original response — before the capacity check, so a batch that succeeded is
  // never refused later because the plan has since filled. See ingest-operation.ts.
  let operationId: string | null = null
  const results: RecordResult[] = []
  if (idempotencyKey) {
    // A key used before reservations existed is recorded as an INGEST_BATCH
    // audit entry. Honour it, or a late retry of an old batch duplicates it.
    const legacy = await prisma.auditEntry.findFirst({
      where: { entityId, eventType: 'INGEST_BATCH', recordId: `batch_${idempotencyKey}` },
      select: { hash: true },
    })
    if (legacy) {
      return NextResponse.json(
        { idempotent: true, message: 'This batch was already processed.', batchAuditHash: legacy.hash },
        { status: 200 },
      )
    }

    const reservation = await reserveIngestOperation(prisma, entityId, idempotencyKey, requestDigest(records))
    if (reservation.kind === 'replay') {
      const replayed = Object.values(reservation.results).sort((a, b) => a.index - b.index) as RecordResult[]
      return NextResponse.json({ idempotent: true, ...summarise(replayed, records.length) }, { status: 200 })
    }
    if (reservation.kind === 'conflict') {
      return NextResponse.json({
        error: 'This idempotency key was already used for a different request.',
        code: 'IDEMPOTENCY_KEY_REUSED',
      }, { status: 422 })
    }
    if (reservation.kind === 'in_progress') {
      return NextResponse.json({
        error: 'A request with this idempotency key is still being processed. Retry shortly.',
        code: 'IN_PROGRESS',
      }, { status: 409 })
    }
    operationId = reservation.id
    results.push(...(Object.values(reservation.done) as RecordResult[]))
  }
  const done = new Set(results.map(r => r.index))

  const capacity = await assertRecordCapacity(entityId, records.length - done.size)
  if (!capacity.allowed) {
    return NextResponse.json({ error: capacity.reason, code: 'PLAN_LIMIT' }, { status: 402 })
  }

  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!entity) {
    return NextResponse.json({ error: 'Entity not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const systemUser = await getSystemUser(entityId)

  for (let i = 0; i < records.length; i++) {
    if (done.has(i)) continue
    const r = records[i]

    if (new Date(r.periodEnd) <= new Date(r.periodStart)) {
      const rejected: RecordResult = { index: i, status: 'rejected', reason: 'periodEnd must be after periodStart', domain: r.domain, fieldName: r.fieldName }
      if (operationId) await claimItem(prisma, operationId, i, rejected)
      results.push(rejected)
      continue
    }

    try {
      const outcome = await runSerializable(async (tx) => {
        // Bound inside the transaction that writes, not just once for the batch:
        // otherwise two batches in flight can both fit against the same count.
        const room = await assertRecordCapacity(entityId, 1, tx)
        if (!room.allowed) throw new Error(room.reason)
        const { recordId } = await writeRecordWithAuditEntry(tx, {
          entityId,
          domain: r.domain,
          fieldName: r.fieldName,
          value: r.value,
          unit: r.unit,
          originalValue: r.value,
          originalUnit: r.unit,
          periodStart: new Date(r.periodStart),
          periodEnd: new Date(r.periodEnd),
          sourceText: r.sourceSystem,
          trustTier: TrustTier.B,
          extractionMethod: ExtractionMethod.SYSTEM_INTEGRATION,
          submittedById: systemUser.id,
        })
        const created: RecordResult = { index: i, status: 'created', recordId, domain: r.domain, fieldName: r.fieldName }
        // Committed with the record, so a retry after a crash knows it landed.
        // If another attempt already recorded this item, abort this write.
        if (operationId) {
          const claim = await claimItem(tx, operationId, i, created)
          if (claim.alreadyDone) throw new AlreadyWritten(claim.result as RecordResult)
        }
        return created
      })
      results.push(outcome)
    } catch (e) {
      if (e instanceof AlreadyWritten) {
        results.push(e.result)
        continue
      }
      // Report the plan limit as the plan limit rather than as an internal error:
      // the caller can act on the first and can do nothing about the second.
      const reason = (e as Error)?.message?.includes('plan')
        ? (e as Error).message
        : 'Internal error writing record'
      // Not recorded against the key: it may succeed on a retry of the same batch.
      results.push({ index: i, status: 'rejected', reason, domain: r.domain, fieldName: r.fieldName, retryable: true })
    }
  }

  results.sort((a, b) => a.index - b.index)
  if (operationId) {
    if (results.some(r => r.status === 'rejected' && r.retryable)) {
      await releaseIngestOperation(prisma, operationId)
    } else {
      await completeIngestOperation(prisma, operationId, Object.fromEntries(results.map(r => [String(r.index), r])))
    }
  }

  return NextResponse.json(summarise(results, records.length), { status: 201 })
}

class AlreadyWritten extends Error {
  constructor(readonly result: RecordResult) {
    super('already written')
  }
}

function summarise(results: RecordResult[], total: number) {
  return {
    created: results.filter(r => r.status === 'created').length,
    rejected: results.filter(r => r.status === 'rejected').length,
    total,
    trustTier: 'B',
    note: 'Records created as Declared (Tier B). Submit supporting documents to upgrade to Verified (Tier A).',
    results,
  }
}
