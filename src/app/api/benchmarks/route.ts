import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const sector = sp.get('sector')
  const domain = sp.get('domain')
  const year = sp.get('year') ? parseInt(sp.get('year')!, 10) : undefined

  const benchmarks = await prisma.sectorBenchmark.findMany({
    where: {
      ...(sector ? { sector } : {}),
      ...(domain ? { domain: domain as never } : {}),
      ...(year ? { year } : {}),
    },
    orderBy: [{ sector: 'asc' }, { domain: 'asc' }, { fieldName: 'asc' }],
  })

  return NextResponse.json({ benchmarks })
}
