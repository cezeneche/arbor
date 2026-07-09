import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
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
      domain: true,
      periodStart: true,
      periodEnd: true,
      grantorEntity: {
        select: {
          legalName: true,
          dataRecords: {
            where: { isActive: true },
            select: { domain: true, trustTier: true, periodStart: true, periodEnd: true },
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
    const records = first.grantorEntity.dataRecords.filter((record) =>
      supplierGrants.some((grant) => {
        const domainMatch = !grant.domain || grant.domain === record.domain
        const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
        const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
        return domainMatch && startMatch && endMatch
      }),
    )
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
