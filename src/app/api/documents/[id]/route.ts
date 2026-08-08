import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth, requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runSerializable } from '@/lib/layer2/serializable'
import { appendAuditEntry } from '@/lib/layer2/audit-append'
import { planDocumentRemoval, buildWithdrawalPayload } from '@/lib/layer2/document-removal'

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

// Remove a document, by the only route its state allows.
//
// Before anything is saved, that is a delete: the file and its extraction go.
// Once it has become records it cannot be, because those records are links in
// the entity's HMAC audit chain and the chain is append-only (PRD §20.3) —
// removing a link would invalidate every hash after it. So a saved document is
// withdrawn: its records leave the active set, so they stop appearing in
// records, totals, coverage and exports, and the chain gains a WITHDRAWN entry
// for each. From the user's side the document and its figures are gone; from the
// chain's side nothing was erased, which is what keeps the earlier hashes valid.
//
// `planDocumentRemoval` decides which of the two applies; this only carries it out.
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
    select: {
      id: true,
      entityId: true,
      status: true,
      dataRecords: {
        where: { isActive: true },
        select: {
          id: true, entityId: true, domain: true, fieldName: true, value: true, unit: true,
          originalValue: true, originalUnit: true, periodStart: true, periodEnd: true,
          trustTier: true, confidenceScore: true, sourceText: true, documentId: true,
          extractionMethod: true,
        },
      },
    },
  })

  if (!document) return err('Document not found', 'NOT_FOUND', 404)
  if (document.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const plan = planDocumentRemoval({ status: document.status, records: document.dataRecords })

  if (plan.mode === 'HARD_DELETE') {
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

    return ok({ deleted: true, withdrawn: 0 })
  }

  // Serializable: previousHash is read and the next link written in one unit, so
  // a concurrent write cannot fork the entity's chain.
  const withdrawnAt = new Date()
  const withdrawnById = session.user!.id!
  const byId = new Map(document.dataRecords.map(r => [r.id, r]))

  await runSerializable(async tx => {
    for (const recordId of plan.recordIds) {
      const record = byId.get(recordId)
      if (!record) continue

      // Every withdrawal in this loop lands in the same transaction and therefore
      // shares a createdAt — appendAuditEntry orders by sequence, so each one still
      // links to the one before it rather than to an arbitrary tie.
      await appendAuditEntry(tx, {
        entityId,
        recordId,
        eventType: 'WITHDRAWN',
        payload: buildWithdrawalPayload(record, { at: withdrawnAt, byId: withdrawnById }),
      })

      // Deactivated, never deleted: the row stays readable from the chain entry
      // that withdrew it, and stops counting towards anything.
      await tx.dataRecord.update({
        where: { id: recordId },
        data: { isActive: false },
      })
    }

    await tx.document.update({ where: { id }, data: { status: 'WITHDRAWN' } })
  })

  return ok({ deleted: true, withdrawn: plan.recordIds.length })
}
