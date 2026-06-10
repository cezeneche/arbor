import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { ok, err } from '@/lib/api-helpers'
import { computeRecordHash } from '@/lib/layer2/audit-chain'
import { formatRecordsAsCSV } from '@/lib/export/csv-formatter'
import { formatRecordsAsXML } from '@/lib/export/xml-formatter'
import type { AuditPayload } from '@/lib/layer2/audit-chain'
import { getSystemUser } from '@/lib/layer2/system-actor'

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
})

const bodySchema = z.array(recordSchema).min(1).max(500)

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get('authorization'))
  if (!auth.authorized) {
    return err(auth.reason ?? 'Unauthorized', 'UNAUTHORIZED', 401)
  }

  const { searchParams } = req.nextUrl
  const domain = searchParams.get('domain') as never | null
  const tier = searchParams.get('tier') as never | null
  const periodStart = searchParams.get('periodStart')
  const periodEnd = searchParams.get('periodEnd')
  const format = searchParams.get('format') ?? 'json'

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId: auth.entityId!,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(tier ? { trustTier: tier } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    select: {
      id: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      trustTier: true,
      confidenceScore: true,
      periodStart: true,
      periodEnd: true,
      extractionMethod: true,
      submittedAt: true,
      documentId: true,
    },
    orderBy: { submittedAt: 'desc' },
  })

  if (format === 'csv') {
    const csv = formatRecordsAsCSV(records)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="arbor-records.csv"',
      },
    })
  }

  if (format === 'xml') {
    const xml = formatRecordsAsXML(records)
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="arbor-records.xml"',
      },
    })
  }

  return ok({ records, count: records.length })
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get('authorization'))
  if (!auth.authorized) {
    return err(auth.reason ?? 'Unauthorized', 'UNAUTHORIZED', 401)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON body', 'INVALID_BODY', 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Request body failed validation',
      code: 'VALIDATION_ERROR',
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    }, { status: 400 })
  }
  const records = parsed.data

  const entity = await prisma.entity.findUnique({ where: { id: auth.entityId! } })
  if (!entity) return err('Entity not found', 'NOT_FOUND', 404)

  const systemUser = await getSystemUser(auth.entityId!)

  const lastAuditEntry = await prisma.auditEntry.findFirst({
    where: { entityId: auth.entityId! },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })

  let previousHash = lastAuditEntry?.hash ?? null
  let createdCount = 0

  for (const r of records) {
    const submittedAt = new Date().toISOString()

    const { hash } = await prisma.$transaction(async (tx) => {
      const record = await tx.dataRecord.create({
        data: {
          entityId: auth.entityId!,
          domain: r.domain as never,
          fieldName: r.fieldName,
          value: r.value,
          unit: r.unit,
          periodStart: new Date(r.periodStart),
          periodEnd: new Date(r.periodEnd),
          trustTier: 'A' as never,
          extractionMethod: 'SYSTEM_INTEGRATION' as never,
          submittedById: systemUser.id,
          confidenceScore: 1.0,
          isActive: true,
          auditHash: '',
        },
      })

      const auditPayload: AuditPayload = {
        recordId: record.id,
        entityId: auth.entityId!,
        domain: r.domain,
        fieldName: r.fieldName,
        value: r.value,
        unit: r.unit,
        trustTier: 'A',
        submittedById: systemUser.id,
        submittedAt,
      }

      const hash = computeRecordHash(auditPayload, previousHash)

      await tx.dataRecord.update({ where: { id: record.id }, data: { auditHash: hash } })

      await tx.auditEntry.create({
        data: {
          entityId: auth.entityId!,
          recordId: record.id,
          eventType: 'CREATED',
          payload: auditPayload as unknown as import('@prisma/client').Prisma.InputJsonValue,
          hash,
          previousHash,
        },
      })

      return { hash }
    })

    previousHash = hash
    createdCount++
  }

  return NextResponse.json({ created: createdCount }, { status: 201 })
}
