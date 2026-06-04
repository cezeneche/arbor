// Layer 3 API — assembles CBAM declaration data and packages it.
// [EU Regulation 2023/1773 Art. 4(1)]

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildCbamUkReturn } from '@/lib/reporting/cbam-uk'
import { buildCbamEuXml } from '@/lib/reporting/cbam-eu-xml'
import type { CbamDeclaration } from '@/lib/reporting/cbam-uk'

// Quarter date ranges (inclusive)
function quarterRange(quarter: string, year: number): { start: Date; end: Date } {
  const q = parseInt(quarter.replace('Q', ''), 10)
  const month = (q - 1) * 3
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 3, 0, 23, 59, 59),
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const sp = req.nextUrl.searchParams
  const quarter = sp.get('quarter') ?? 'Q1'
  const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()), 10)

  const { start, end } = quarterRange(quarter, year)

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { legalName: true },
  })

  // Fetch all CBAM_DECLARATION documents for the entity in this quarter
  const documents = await prisma.document.findMany({
    where: {
      entityId,
      documentType: 'CBAM_DECLARATION',
      submittedAt: { gte: start, lte: end },
      status: 'ACCEPTED',
    },
    include: {
      extractionJobs: {
        where: { status: 'COMPLETE' },
        orderBy: { startedAt: 'desc' },
        take: 1,
        include: { extractedFields: true },
      },
      dataRecords: {
        where: { isActive: true, domain: 'COMPLIANCE' },
      },
    },
  })

  const declarations: CbamDeclaration[] = documents.flatMap(doc => {
    const fields = doc.extractionJobs[0]?.extractedFields ?? []
    const records = doc.dataRecords

    const getField = (name: string) =>
      fields.find(f => f.fieldName === name)?.rawValue ?? null
    const getNumericRecord = (name: string) =>
      records.find(r => r.fieldName === name)?.value ?? null

    const embeddedEmissions = getNumericRecord('embedded_emissions_co2e')
    const declaredWeight = getNumericRecord('declared_weight')

    if (embeddedEmissions === null || declaredWeight === null) return []

    const periodStart = records[0]?.periodStart ?? doc.submittedAt
    const periodEnd = records[0]?.periodEnd ?? doc.submittedAt

    const dominantTier: 'A' | 'B' | 'C' =
      records.some(r => r.trustTier === 'B') ? 'B' :
      records.some(r => r.trustTier === 'C') ? 'C' : 'A'

    return [{
      id: doc.id,
      declarationReference: getField('declaration_reference') ?? doc.id,
      commodityCode: getField('commodity_code') ?? '',
      commodityDescription: getField('commodity_description') ?? '',
      countryOfOrigin: getField('country_of_origin') ?? '',
      importerName: entity?.legalName ?? '',
      declarantName: entity?.legalName ?? '',
      declaredWeight,
      embeddedEmissionsKgCo2e: embeddedEmissions,
      calculationTier: getField('calculation_tier') ?? '3',
      trustTier: dominantTier,
      periodStart,
      periodEnd,
    }]
  })

  const input = {
    entityName: entity?.legalName ?? '',
    entityId,
    quarter,
    year,
    declarations,
  }

  const ukReturn = buildCbamUkReturn(input)
  const euXml = buildCbamEuXml(input)

  return NextResponse.json({ ukReturn, euXml, documentCount: documents.length })
}
