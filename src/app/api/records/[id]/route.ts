import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { id } = await params

  const record = await prisma.dataRecord.findUnique({
    where: { id },
    include: { validationFlags: true, document: true },
  })

  if (!record) return err('Record not found', 'NOT_FOUND', 404)
  if (record.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const auditEntry = await prisma.auditEntry.findFirst({
    where: { recordId: id },
    orderBy: { createdAt: 'desc' },
  })

  return ok({ ...record, auditEntry })
}
