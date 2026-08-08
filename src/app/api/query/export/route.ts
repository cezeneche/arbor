// Layer 3 — read-only. Buyer-facing multi-supplier export endpoint.
// Auth: session only (buyers). Validates grants before returning any supplier data.
// Trust tier and provenance travel with every record — cannot be removed (PRD §21.2).
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { formatRecordsAsCSV } from '@/lib/export/csv-formatter'
import { formatRecordsAsXML } from '@/lib/export/xml-formatter'
import { withDefinitions } from '@/lib/layer3/load-definitions'
import { domainSchema } from '@/lib/constants'
import type { DataDomain } from '@prisma/client'
import { GRANT_SCOPE_SELECT, toGrantScope, anyGrantCoversRecord } from '@/lib/layer3/grant-scope'

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const buyerEntityId = getSessionUser(session).entityId as string

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
    select: { grantorEntityId: true, ...GRANT_SCOPE_SELECT },
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
      submittedAt: true,
    },
    orderBy: [{ entityId: 'asc' }, { domain: 'asc' }, { periodStart: 'asc' }],
  })

  // Enforce each grant's scope on the fetched records, through grant-scope rather
  // than a local restatement of the rule — an export that reads on its own copy of
  // the rules is an export that keeps reading on the old ones.
  const records = candidateRecords.filter(record =>
    anyGrantCoversRecord(
      grants.filter(g => g.grantorEntityId === record.entityId).map(toGrantScope),
      record,
    ),
  )

  // Attach the agreed business definition in force when each record was submitted,
  // plus this buyer's agreement state for that wording. Travels with the data on
  // the same terms as trust tier — a number without its boundary is not usable.
  const decorated = await withDefinitions(records, buyerEntityId)

  if (format === 'xml') {
    const xml = formatRecordsAsXML(decorated)
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="arbor-export.xml"' },
    })
  }

  const csv = formatRecordsAsCSV(decorated)
  return new NextResponse(csv, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="arbor-export.csv"' },
  })
}
