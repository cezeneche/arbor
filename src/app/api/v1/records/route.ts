import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { ok, err } from '@/lib/api-helpers'
import { computeRecordHash } from '@/lib/calculation/audit-chain'
import { formatRecordsAsCSV } from '@/lib/export/csv-formatter'
import { formatRecordsAsXML } from '@/lib/export/xml-formatter'
import type { AuditPayload } from '@/lib/calculation/audit-chain'

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

  const records = body as Array<{
    domain: string
    fieldName: string
    value: number
    unit: string
    periodStart: string
    periodEnd: string
    scope3Category?: number
  }>

  if (!Array.isArray(records) || records.length === 0) {
    return err('Body must be a non-empty array of records', 'INVALID_BODY', 400)
  }

  const entity = await prisma.entity.findUnique({ where: { id: auth.entityId! } })
  if (!entity) return err('Entity not found', 'NOT_FOUND', 404)

  const lastAuditEntry = await prisma.auditEntry.findFirst({
    where: { entityId: auth.entityId! },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })

  const created = await prisma.dataRecord.createMany({
    data: records.map((r) => {
      const auditPayload: AuditPayload = {
        recordId: '',
        entityId: auth.entityId!,
        domain: r.domain,
        fieldName: r.fieldName,
        value: r.value,
        unit: r.unit,
        trustTier: 'A',
        submittedById: entity.id,
        submittedAt: new Date().toISOString(),
      }
      const auditHash = computeRecordHash(auditPayload, lastAuditEntry?.hash ?? null)
      return {
        entityId: auth.entityId!,
        domain: r.domain as never,
        fieldName: r.fieldName,
        value: r.value,
        unit: r.unit,
        periodStart: new Date(r.periodStart),
        periodEnd: new Date(r.periodEnd),
        scope3Category: r.scope3Category ?? null,
        trustTier: 'A' as never,
        extractionMethod: 'ERP_DIRECT' as never,
        submittedById: entity.id,
        confidenceScore: 1.0,
        isActive: true,
        auditHash,
      }
    }),
  })

  return NextResponse.json({ created: created.count }, { status: 201 })
}
