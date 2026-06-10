import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { ok, err } from '@/lib/api-helpers'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { formatRecordsAsCSV } from '@/lib/export/csv-formatter'
import { formatRecordsAsXML } from '@/lib/export/xml-formatter'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { domainSchema, tierSchema } from '@/lib/constants'
import { TrustTier, ExtractionMethod } from '@prisma/client'

const recordSchema = z.object({
  domain: domainSchema,
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
  const domainParam = searchParams.get('domain')
  const tierParam = searchParams.get('tier')
  const periodStart = searchParams.get('periodStart')
  const periodEnd = searchParams.get('periodEnd')
  const format = searchParams.get('format') ?? 'json'

  if (domainParam) {
    const result = domainSchema.safeParse(domainParam)
    if (!result.success) return err(`Invalid domain '${domainParam}'`, 'VALIDATION_ERROR', 400)
  }
  if (tierParam) {
    const result = tierSchema.safeParse(tierParam)
    if (!result.success) return err(`Invalid tier '${tierParam}'`, 'VALIDATION_ERROR', 400)
  }

  const domain = domainParam ? domainSchema.parse(domainParam) : undefined
  const tier = tierParam ? tierSchema.parse(tierParam) : undefined

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
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="arbor-records.csv"' },
    })
  }

  if (format === 'xml') {
    const xml = formatRecordsAsXML(records)
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="arbor-records.xml"' },
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
  let createdCount = 0

  for (const r of records) {
    if (new Date(r.periodEnd) <= new Date(r.periodStart)) continue

    // API key writes have no supporting document — Tier B per PRD §12.
    await prisma.$transaction(
      (tx) =>
        writeRecordWithAuditEntry(tx, {
          entityId: auth.entityId!,
          domain: r.domain,
          fieldName: r.fieldName,
          value: r.value,
          unit: r.unit,
          periodStart: new Date(r.periodStart),
          periodEnd: new Date(r.periodEnd),
          trustTier: TrustTier.B,
          extractionMethod: ExtractionMethod.SYSTEM_INTEGRATION,
          submittedById: systemUser.id,
        }),
      { isolationLevel: 'Serializable' },
    )
    createdCount++
  }

  return NextResponse.json({ created: createdCount }, { status: 201 })
}
