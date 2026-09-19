import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { domainSchema, tierSchema } from '@/lib/constants'
import { parsePageParams } from '@/lib/page-params'

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { searchParams } = req.nextUrl

  const domainParam = searchParams.get('domain')
  const tierParam = searchParams.get('tier')
  const periodStartParam = searchParams.get('periodStart')
  const periodEndParam = searchParams.get('periodEnd')

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

  let periodStart: Date | undefined
  let periodEnd: Date | undefined

  if (periodStartParam) {
    periodStart = new Date(periodStartParam)
    if (isNaN(periodStart.getTime())) return err('Invalid periodStart', 'VALIDATION_ERROR', 400)
  }
  if (periodEndParam) {
    periodEnd = new Date(periodEndParam)
    if (isNaN(periodEnd.getTime())) return err('Invalid periodEnd', 'VALIDATION_ERROR', 400)
  }

  const page = parsePageParams(searchParams)
  if (!page.ok) return err(page.error, 'VALIDATION_ERROR', 400)

  const where = {
    entityId,
    isActive: true,
    ...(domain ? { domain } : {}),
    ...(tier ? { trustTier: tier } : {}),
    ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
    ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
  }
  // A bounded page, never the whole store. The body stays an array for
  // existing callers; the total and the page travel in headers.
  const [records, total] = await Promise.all([
    prisma.dataRecord.findMany({
      where,
      include: { validationFlags: true },
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      take: page.limit,
      skip: page.offset,
    }),
    prisma.dataRecord.count({ where }),
  ])

  const res = ok(records)
  res.headers.set('x-total-count', String(total))
  res.headers.set('x-limit', String(page.limit))
  res.headers.set('x-offset', String(page.offset))
  return res
}
