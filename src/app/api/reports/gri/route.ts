// Layer 3 API — builds GRI 305 disclosure from DataRecords.
// [GRI 305: Emissions 2016]

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildGri305Disclosure } from '@/lib/reporting/gri-305'
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

  const scope1Records = allRecords
    .filter(r => r.domain === 'EMISSIONS')
    .map(r => ({ id: r.id, fieldName: r.fieldName, value: r.value, unit: r.unit, trustTier: r.trustTier as 'A' | 'B' | 'C' }))

  const scope2Records = allRecords
    .filter(r => r.domain === 'ENERGY')
    .map(r => ({ id: r.id, fieldName: r.fieldName, value: r.value, unit: r.unit, trustTier: r.trustTier as 'A' | 'B' | 'C' }))

  const scope3Records = allRecords.filter(r => r.scope3Category !== null)

  const scope3Inventory = buildScope3Inventory({
    records: scope3Records.map(r => ({ ...r, trustTier: r.trustTier as 'A' | 'B' | 'C' })),
    emissionFactors,
  })

  const disclosure = buildGri305Disclosure({
    entityName: entity?.legalName ?? '',
    reportingYear: year,
    scope1Records,
    scope2Records,
    scope3Inventory,
  })

  return NextResponse.json({ disclosure })
}
