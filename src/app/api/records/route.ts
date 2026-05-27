import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { searchParams } = req.nextUrl

  const domain = searchParams.get('domain') as never | null
  const tier = searchParams.get('tier') as never | null
  const periodStart = searchParams.get('periodStart')
  const periodEnd = searchParams.get('periodEnd')

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(tier ? { trustTier: tier } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    include: { validationFlags: true },
    orderBy: { submittedAt: 'desc' },
  })

  if (!records) return err('Records not found', 'NOT_FOUND', 404)

  return ok(records)
}
