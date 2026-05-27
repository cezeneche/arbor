import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const { id } = await params

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      extractionJobs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        include: { extractedFields: true },
      },
    },
  })

  if (!document) return err('Document not found', 'NOT_FOUND', 404)
  if (document.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  return ok(document)
}
