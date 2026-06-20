import { NextRequest } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// Revoke a share. After this the public page reveals no data. Idempotent.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { id } = await params

  const share = await prisma.sharedExport.findUnique({ where: { id } })
  if (!share || share.entityId !== entityId) return err('Share not found', 'NOT_FOUND', 404)

  if (!share.revokedAt) {
    await prisma.sharedExport.update({ where: { id }, data: { revokedAt: new Date() } })
  }

  return ok({ id, revoked: true })
}
