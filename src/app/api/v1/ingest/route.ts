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
import type { Prisma } from '@prisma/client'

const VALID_DOMAINS = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as const

const recordSchema = z.object({
  domain: z.enum(VALID_DOMAINS),
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
  // Look up by recordId pattern (batch_<key>) — avoids searching inside JSON payload.
  if (idempotencyKey) {
    const previous = await prisma.auditEntry.findFirst({
      where: {
        entityId,
        eventType: 'INGEST_BATCH',
        recordId: `batch_${idempotencyKey}`,
      },
    })
    if (previous) {
      return NextResponse.json({
        idempotent: true,
        message: 'This batch was already processed.',
        batchAuditHash: previous.hash,
      }, { status: 200 })
    }
  }

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { id: true },
  })
  if (!entity) {
    return NextResponse.json({ error: 'Entity not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const adminUser = await prisma.user.findFirst({
    where: { entityId, role: 'ADMIN' },
    select: { id: true },
  })
  if (!adminUser) {
    return NextResponse.json({ error: 'No admin user found for entity', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
  const submittedById = adminUser.id

  const lastAuditEntry = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })

  const results: RecordResult[] = []
  let previousHash = lastAuditEntry?.hash ?? null

  for (let i = 0; i < records.length; i++) {
    const r = records[i]

    // Business rule: period end must be after period start
    if (new Date(r.periodEnd) <= new Date(r.periodStart)) {
      results.push({
        index: i,
        status: 'rejected',
        reason: 'periodEnd must be after periodStart',
        domain: r.domain,
        fieldName: r.fieldName,
      })
      continue
    }

    try {
      const submittedAt = new Date().toISOString()

      // Transaction: record create + hash update + audit entry are atomic.
      // A failure mid-way cannot leave a record with auditHash='' or without an entry.
      const { finalHash } = await prisma.$transaction(async (tx) => {
        const record = await tx.dataRecord.create({
          data: {
            entityId,
            domain: r.domain,
            fieldName: r.fieldName,
            value: r.value,
            unit: r.unit,
            periodStart: new Date(r.periodStart),
            periodEnd: new Date(r.periodEnd),
            trustTier: 'B',
            extractionMethod: 'SYSTEM_INTEGRATION',
            submittedById,
            confidenceScore: 1.0,
            isActive: true,
            auditHash: '',
          },
        })

        const auditPayload: AuditPayload = {
          recordId: record.id,
          entityId,
          domain: r.domain,
          fieldName: r.fieldName,
          value: r.value,
          unit: r.unit,
          trustTier: 'B',
          submittedAt,
          submittedById,
        }

        const hash = computeRecordHash(auditPayload, previousHash)

        await tx.dataRecord.update({ where: { id: record.id }, data: { auditHash: hash } })

        await tx.auditEntry.create({
          data: {
            entityId,
            recordId: record.id,
            eventType: 'CREATED',
            payload: auditPayload as unknown as Prisma.InputJsonValue,
            hash,
            previousHash,
          },
        })

        results.push({ index: i, status: 'created', recordId: record.id, domain: r.domain, fieldName: r.fieldName })
        return { finalHash: hash }
      })

      previousHash = finalHash
    } catch {
      results.push({
        index: i,
        status: 'rejected',
        reason: 'Internal error writing record',
        domain: r.domain,
        fieldName: r.fieldName,
      })
    }
  }

  const created = results.filter(r => r.status === 'created').length
  const rejected = results.filter(r => r.status === 'rejected').length

  // Write a batch audit entry for idempotency lookups.
  // Payload must exactly match what was passed to computeRecordHash so verifyChain() passes.
  if (idempotencyKey) {
    const batchPayload: AuditPayload = {
      recordId: `batch_${idempotencyKey}`,
      entityId,
      domain: 'COMPLIANCE',
      fieldName: 'ingest_batch',
      value: created,
      unit: 'records',
      trustTier: 'B',
      submittedAt: new Date().toISOString(),
      submittedById,
    }
    const batchHash = computeRecordHash(batchPayload, previousHash)
    await prisma.auditEntry.create({
      data: {
        entityId,
        recordId: batchPayload.recordId,
        eventType: 'INGEST_BATCH',
        payload: batchPayload as unknown as Prisma.InputJsonValue,
        hash: batchHash,
        previousHash,
      },
    }).catch(() => {}) // non-critical
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
