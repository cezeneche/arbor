import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const { id } = await params
  const entityId = getSessionUser(session).entityId as string

  const request = await prisma.dataRequest.findUnique({ where: { id } })
  if (!request) return err('Request not found', 'NOT_FOUND', 404)
  if (request.buyerEntityId !== entityId) return err('Forbidden', 'FORBIDDEN', 403)

  const token = randomUUID()
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await prisma.dataRequest.update({
    where: { id },
    data: { submissionToken: token, submissionTokenExpiry: expiry },
  })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const link = `${baseUrl}/submit/${token}`

  return ok({ link, expiresAt: expiry.toISOString() }, 201)
}
