import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyChain } from '@/lib/calculation/audit-chain'
import type { AuditPayload } from '@/lib/calculation/audit-chain'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const sp = req.nextUrl.searchParams
  const periodStart = sp.get('periodStart')
  const periodEnd = sp.get('periodEnd')

  const [records, auditEntries, crossValidations] = await Promise.all([
    prisma.dataRecord.findMany({
      where: {
        entityId,
        isActive: true,
        ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
        ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
      },
      include: {
        document: { select: { fileName: true, documentType: true } },
        validationFlags: true,
      },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.auditEntry.findMany({
      where: { entityId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.crossValidationResult.findMany({
      where: { entityId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const chainEntries = auditEntries.map(e => ({
    hash: e.hash,
    previousHash: e.previousHash,
    payload: e.payload as unknown as AuditPayload,
  }))

  const chainIntegrityVerified = verifyChain(chainEntries)

  return NextResponse.json({
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
