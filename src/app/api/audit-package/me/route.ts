import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { assembleAuditPackage } from '@/lib/audit-package/assemble'

// Layer 3 — generate the caller's own audit package, including (Gap 3) any
// third-party verification block and (Gap 4) the integrity hash + public
// verification instructions. Generation is logged for later public verification.
export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const userId = (session.user as Record<string, unknown>).id as string

  const sp = req.nextUrl.searchParams
  const periodStart = sp.get('periodStart')
  const periodEnd = sp.get('periodEnd')

  const { package: pkg, chainIntegrityVerified, auditEntryCount, merkleShadow } =
    await assembleAuditPackage({
      entityId,
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      logRequestedById: userId,
    })

  return NextResponse.json({
    generatedAt: pkg.generatedAt.toISOString(),
    entityId,
    entityName: pkg.entityName,
    periodStart,
    periodEnd,
    recordCount: pkg.summary.totalRecords,
    summary: pkg.summary,
    records: pkg.dataRecords,
    sourceDocuments: pkg.sourceDocuments,
    crossValidations: pkg.crossValidationResults,
    auditChain: { entryCount: auditEntryCount, chainIntegrityVerified },
    // Upgrade 7 — Merkle commitment + per-record inclusion proofs, plus the
    // shadow-compare confirming it agrees with the linear HMAC chain.
    merkle: pkg.merkle,
    merkleShadow,
    verification: pkg.verification,
    packageIntegrityHash: pkg.packageIntegrityHash,
    verificationInstructions: pkg.verificationInstructions,
  })
}
