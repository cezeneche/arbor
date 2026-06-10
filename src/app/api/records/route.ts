import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { domainSchema, tierSchema } from '@/lib/constants'

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
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

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(tier ? { trustTier: tier } : {}),
      ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
      ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
    },
    include: { validationFlags: true },
    orderBy: { submittedAt: 'desc' },
  })

  return ok(records)
}
