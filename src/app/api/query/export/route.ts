// Layer 3 — read-only. Buyer-facing multi-supplier export endpoint.
// Auth: session only (buyers). Validates grants before returning any supplier data.
// Trust tier and provenance travel with every record — cannot be removed (PRD §21.2).
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { formatRecordsAsCSV } from '@/lib/export/csv-formatter'
import { formatRecordsAsXML } from '@/lib/export/xml-formatter'
import { domainSchema } from '@/lib/constants'
import type { DataDomain } from '@prisma/client'

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const buyerEntityId = (session.user as Record<string, unknown>).entityId as string

  const sp = req.nextUrl.searchParams
  const format = sp.get('format') ?? 'csv'
  const domainParam = sp.get('domain')
  const periodStart = sp.get('periodStart') ?? undefined
  const periodEnd = sp.get('periodEnd') ?? undefined
  const supplierIdsParam = sp.get('supplierEntityIds')

  if (domainParam) {
    const result = domainSchema.safeParse(domainParam)
    if (!result.success) {
      return NextResponse.json({ error: `Invalid domain '${domainParam}'` }, { status: 400 })
    }
  }

  const domain: DataDomain | undefined = domainParam ? domainSchema.parse(domainParam) : undefined

  // Resolve which suppliers this buyer is authorised to access, retaining each grant's scope
  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      granteeEntityId: buyerEntityId,
      isActive: true,
      revokedAt: null,
    },
    select: { grantorEntityId: true, domain: true, periodStart: true, periodEnd: true },
  })
  const authorisedSupplierIds = new Set(grants.map(g => g.grantorEntityId))

  if (authorisedSupplierIds.size === 0) {
    // 204 No Content — authorised but nothing to export yet
    return new NextResponse(null, { status: 204 })
  }

  // If specific suppliers requested, intersect with authorised set
  let targetIds = [...authorisedSupplierIds]
  if (supplierIdsParam) {
    const requested = supplierIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    targetIds = requested.filter(id => authorisedSupplierIds.has(id))
    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'None of the requested suppliers are authorised.' }, { status: 403 })
    }
  }

  const candidateRecords = await prisma.dataRecord.findMany({
    where: {
      entityId: { in: targetIds },
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    select: {
      id: true,
      entityId: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      trustTier: true,
      confidenceScore: true,
      periodStart: true,
      periodEnd: true,
      extractionMethod: true,
      documentId: true,
    },
    orderBy: [{ entityId: 'asc' }, { domain: 'asc' }, { periodStart: 'asc' }],
  })

  // Enforce each grant's domain and period bounds on the fetched records
  const records = candidateRecords.filter(record => {
    const entityGrants = grants.filter(g => g.grantorEntityId === record.entityId)
    return entityGrants.some(grant => {
      const domainMatch = !grant.domain || grant.domain === record.domain
      const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
      const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
      return domainMatch && startMatch && endMatch
    })
  })

  if (format === 'xml') {
    const xml = formatRecordsAsXML(records)
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="arbor-export.xml"' },
    })
  }

  const csv = formatRecordsAsCSV(records)
  return new NextResponse(csv, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="arbor-export.csv"' },
  })
}
