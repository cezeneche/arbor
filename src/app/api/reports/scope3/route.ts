// Layer 2/3 API — builds Scope 3 inventory from active DataRecords.
// [GHG Protocol Scope 3 Standard — all fifteen categories]

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildScope3Inventory } from '@/lib/scope3/inventory'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const sp = req.nextUrl.searchParams
  const periodStart = sp.get('periodStart') ? new Date(sp.get('periodStart')!) : undefined
  const periodEnd = sp.get('periodEnd') ? new Date(sp.get('periodEnd')!) : undefined

  const [records, emissionFactors] = await Promise.all([
    prisma.dataRecord.findMany({
      where: {
        entityId,
        isActive: true,
        scope3Category: { not: null },
        ...(periodStart && periodEnd
          ? { periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } }
          : {}),
      },
      select: {
        id: true,
        domain: true,
        scope3Category: true,
        fieldName: true,
        value: true,
        unit: true,
        trustTier: true,
        extractionMethod: true,
      },
    }),
    prisma.emissionFactor.findMany({
      where: {
        isActive: true,
        OR: [{ entityId: null }, { entityId }],
      },
      select: {
        activityType: true,
        factor: true,
        unit: true,
        source: true,
        version: true,
        citation: true,
      },
    }),
  ])

  const inventory = buildScope3Inventory({
    records: records.map(r => ({
      ...r,
      trustTier: r.trustTier as 'A' | 'B' | 'C',
      scope3Category: r.scope3Category,
    })),
    emissionFactors,
  })

  return NextResponse.json({ inventory, recordCount: records.length })
}
