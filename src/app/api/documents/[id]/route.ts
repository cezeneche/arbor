import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth, requireWriteAccess } from '@/lib/auth-helpers'
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

// Discard a document that has not become records yet.
//
// Deliberately refused once the document is ACCEPTED: its records are in the
// audit chain, and the chain is append-only. Corrections there supersede, they
// never delete (PRD §20.3). So this only reaches a document still sitting in
// review or one that failed to parse — nothing certified is reachable from here.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { id } = await params

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, entityId: true, status: true, _count: { select: { dataRecords: true } } },
  })

  if (!document) return err('Document not found', 'NOT_FOUND', 404)
  if (document.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)
  if (document.status === 'ACCEPTED' || document._count.dataRecords > 0) {
    return err(
      'This document has already been saved as records. Records are never deleted — upload a corrected document to supersede them.',
      'ALREADY_CONFIRMED',
      409,
    )
  }

  // The extraction and its fields exist only to serve this document.
  await prisma.$transaction(async tx => {
    const jobs = await tx.extractionJob.findMany({ where: { documentId: id }, select: { id: true } })
    if (jobs.length > 0) {
      await tx.extractedField.deleteMany({ where: { extractionJobId: { in: jobs.map(j => j.id) } } })
      await tx.extractionJob.deleteMany({ where: { documentId: id } })
    }
    await tx.groundTruthLabel.deleteMany({ where: { documentId: id } })
    await tx.document.delete({ where: { id } })
  })

  return ok({ deleted: true })
}
