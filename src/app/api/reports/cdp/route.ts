// Layer 3 API — builds CDP Climate Change C6 disclosure from DataRecords.
// [CDP Climate Change Questionnaire — Section C6]

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildCdpClimateDisclosure } from '@/lib/reporting/cdp-climate'
import { buildScope3Inventory } from '@/lib/scope3/inventory'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const sp = req.nextUrl.searchParams
  const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()), 10)
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31, 23, 59, 59)

  const [entity, allRecords, emissionFactors] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { legalName: true } }),
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true, periodStart: { gte: yearStart }, periodEnd: { lte: yearEnd } },
      select: { id: true, domain: true, fieldName: true, value: true, unit: true, trustTier: true, scope3Category: true, extractionMethod: true },
    }),
    prisma.emissionFactor.findMany({
      where: { isActive: true, OR: [{ entityId: null }, { entityId }] },
      select: { activityType: true, factor: true, unit: true, source: true, version: true, citation: true },
    }),
  ])

  const scope1Records = allRecords.filter(r => r.domain === 'EMISSIONS')
  const scope2Records = allRecords.filter(r => r.domain === 'ENERGY')
  const scope3Records = allRecords.filter(r => r.scope3Category !== null)

  const scope3Inventory = buildScope3Inventory({
    records: scope3Records.map(r => ({ ...r, trustTier: r.trustTier as 'A' | 'B' | 'C' })),
    emissionFactors,
  })

  const lowestTier = (records: typeof scope1Records): 'A' | 'B' | 'C' => {
    const tiers = records.map(r => r.trustTier)
    if (tiers.includes('C')) return 'C'
    if (tiers.includes('B')) return 'B'
    return 'A'
  }

  const scope1Total = scope1Records.reduce((s, r) => s + r.value, 0)
  const scope2Total = scope2Records.reduce((s, r) => s + r.value, 0)

  const disclosure = buildCdpClimateDisclosure({
    entityName: entity?.legalName ?? '',
    reportingYear: year,
    scope1KgCo2e: scope1Total,
    scope1TrustTier: scope1Records.length > 0 ? lowestTier(scope1Records) : 'C',
    scope2LocationBasedKgCo2e: scope2Total,
    scope2TrustTier: scope2Records.length > 0 ? lowestTier(scope2Records) : 'C',
    scope3Inventory,
  })

  return NextResponse.json({ disclosure })
}
