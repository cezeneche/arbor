// Layer 3 API — packages DataRecords into ESRS E1 disclosure format.
// [EU 2023/2772 Commission Delegated Regulation, ESRS E1]

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildCsrdE1Disclosure } from '@/lib/reporting/csrd'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const sp = req.nextUrl.searchParams
  const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()), 10)

  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31, 23, 59, 59)

  const [entity, records] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { legalName: true } }),
    prisma.dataRecord.findMany({
      where: {
        entityId,
        isActive: true,
        periodStart: { gte: yearStart },
        periodEnd: { lte: yearEnd },
      },
      select: {
        id: true,
        domain: true,
        fieldName: true,
        value: true,
        unit: true,
        trustTier: true,
        scope3Category: true,
        periodStart: true,
        periodEnd: true,
      },
    }),
  ])

  const disclosure = buildCsrdE1Disclosure({
    entityName: entity?.legalName ?? '',
    reportingYear: year,
    dataRecords: records.map(r => ({
      ...r,
      trustTier: r.trustTier as 'A' | 'B' | 'C',
    })),
  })

  return NextResponse.json({ disclosure, recordCount: records.length })
}
