import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const sessionEntityId = (session.user as Record<string, unknown>).entityId as string
  const { entityId } = await params

  if (sessionEntityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)), 100)
  const skip = (page - 1) * limit

  const [entries, total] = await Promise.all([
    prisma.auditEntry.findMany({
      where: { entityId },
      orderBy: { createdAt: 'asc' },
      skip,
      take: limit,
    }),
    prisma.auditEntry.count({ where: { entityId } }),
  ])

  return ok({ entries, total, page, limit })
}
