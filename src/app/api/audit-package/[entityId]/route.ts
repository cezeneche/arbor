import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { verifyChain } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const sessionEntityId = getSessionUser(session).entityId as string
  const { entityId } = await params

  if (sessionEntityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const periodStart = req.nextUrl.searchParams.get('periodStart')
  const periodEnd = req.nextUrl.searchParams.get('periodEnd')

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    include: {
      validationFlags: true,
      document: { select: { fileName: true, documentType: true, blobUrl: true } },
    },
    orderBy: { submittedAt: 'asc' },
  })

  const auditEntries = await prisma.auditEntry.findMany({
    where: { entityId },
    orderBy: { sequence: 'asc' },
  })

  const crossValidations = await prisma.crossValidationResult.findMany({
    where: { entityId },
    orderBy: { createdAt: 'asc' },
  })

  const chainEntries = auditEntries.map((e) => ({
    hash: e.hash,
    previousHash: e.previousHash,
    payload: e.payload as unknown as AuditPayload,
  }))

  const chainIntegrityVerified = verifyChain(chainEntries)

  return ok({
    generatedAt: new Date().toISOString(),
    entityId,
    periodStart,
    periodEnd,
    recordCount: records.length,
    records,
    auditChain: { entryCount: auditEntries.length, chainIntegrityVerified },
    crossValidations,
  })
}
