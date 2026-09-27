import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import { GRANT_SCOPE_SELECT, anyGrantCoversRecord, toGrantScope } from '@/lib/layer3/grant-scope'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

// buyer API: list suppliers that have granted the caller access, with
// a data-coverage summary. Authenticated by API key (the caller is the buyer).
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKeyRequest(req)
  if (!auth.authorized || !auth.entityId) {
    return NextResponse.json({ error: auth.reason ?? 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  const buyerEntityId = auth.entityId

  const { allowed } = await checkRateLimit(RATE_LIMITS.buyerApi, buyerEntityId)
  if (!allowed) return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' }, { status: 429 })

  const grants = await prisma.dataAccessGrant.findMany({
    where: { granteeEntityId: buyerEntityId, isActive: true, revokedAt: null },
    select: {
      grantorEntityId: true,
      ...GRANT_SCOPE_SELECT,
      grantorEntity: {
        select: {
          legalName: true,
          dataRecords: {
            where: { isActive: true },
            select: { domain: true, fieldName: true, trustTier: true, periodStart: true, periodEnd: true },
          },
        },
      },
    },
  })

  const bySupplier = new Map<string, typeof grants>()
  for (const g of grants) {
    const arr = bySupplier.get(g.grantorEntityId) ?? []
    arr.push(g)
    bySupplier.set(g.grantorEntityId, arr)
  }

  const suppliers = [...bySupplier.entries()].map(([supplierId, supplierGrants]) => {
    const first = supplierGrants[0]
    // The one shared rule, field restriction included.
    const scopes = supplierGrants.map(toGrantScope)
    const records = first.grantorEntity.dataRecords.filter((record) => anyGrantCoversRecord(scopes, record))
    const domains = [...new Set(records.map((r) => r.domain))]
    return {
      supplierId,
      supplierName: first.grantorEntity.legalName,
      domains,
      recordCount: records.length,
      trustTierDistribution: {
        A: records.filter((r) => r.trustTier === 'A').length,
        B: records.filter((r) => r.trustTier === 'B').length,
        C: records.filter((r) => r.trustTier === 'C').length,
      },
    }
  })

  return NextResponse.json({ suppliers })
}
