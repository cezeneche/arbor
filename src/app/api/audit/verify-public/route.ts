import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyChain, type AuditPayload } from '@/lib/layer2/audit-chain'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'

// Gap 4 — public, unauthenticated audit-package verification.
// An external auditor holding a generated package can confirm its integrity hash
// against this endpoint without an Arbor account. Returns no records or PII.
// Always responds 200 (never reveals whether an entityId exists via status code).
export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.verifyPublic, ip)
  if (!allowed) {
    return NextResponse.json({ verified: false, reason: 'Too many requests' }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams
  const packageHash = sp.get('packageHash')
  const entityId = sp.get('entityId')

  if (!packageHash || !entityId) {
    return NextResponse.json({ verified: false, reason: 'packageHash and entityId are required' })
  }

  const log = await prisma.auditPackageLog.findFirst({
    where: { entityId, packageHash },
    orderBy: { generatedAt: 'desc' },
  })

  if (!log) {
    return NextResponse.json({ verified: false, reason: 'Package hash not recognised' })
  }

  // Re-verify the entity's audit chain at request time.
  const auditEntries = await prisma.auditEntry.findMany({
    where: { entityId },
    orderBy: { createdAt: 'asc' },
    select: { hash: true, previousHash: true, payload: true },
  })
  const chainValid = verifyChain(
    auditEntries.map((e) => ({
      hash: e.hash,
      previousHash: e.previousHash,
      payload: e.payload as unknown as AuditPayload,
    })),
  )

  return NextResponse.json({
    verified: chainValid,
    entryCount: auditEntries.length,
    verifiedAt: new Date().toISOString(),
    packageGeneratedAt: log.generatedAt.toISOString(),
  })
}
