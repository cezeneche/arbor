import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const { id } = await params
  const key = await prisma.apiKey.findUnique({ where: { id } })

  if (!key) return NextResponse.json({ error: 'Key not found.' }, { status: 404 })
  if (key.entityId !== entityId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  if (!key.isActive) return NextResponse.json({ error: 'Key already revoked.' }, { status: 409 })

  await prisma.apiKey.update({
    where: { id },
    data: { isActive: false, revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
