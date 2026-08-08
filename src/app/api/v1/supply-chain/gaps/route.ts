import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { ALL_DOMAINS } from '@/lib/constants'
import { computeScopedGaps, type GapRecord } from '@/lib/layer3/supply-chain-gaps'
import type { GrantScope } from '@/lib/layer3/grant-scope'
import { GRANT_SCOPE_SELECT, toGrantScope } from '@/lib/layer3/grant-scope'

const querySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

// buyer API: which supplier+domain combinations have no records, or
// only Tier C (estimated) records, for the requested period.
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKeyRequest(req)
  if (!auth.authorized || !auth.entityId) {
    return NextResponse.json({ error: auth.reason ?? 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  const buyerEntityId = auth.entityId

  const { allowed } = await checkRateLimit(RATE_LIMITS.buyerApi, buyerEntityId)
  if (!allowed) return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' }, { status: 429 })

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const ps = parsed.data.periodStart ? new Date(parsed.data.periodStart) : null
  const pe = parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null

  const grants = await prisma.dataAccessGrant.findMany({
    where: { granteeEntityId: buyerEntityId, isActive: true, revokedAt: null },
    select: {
      grantorEntityId: true,
      ...GRANT_SCOPE_SELECT,
      grantorEntity: {
        select: {
          legalName: true,
          dataRecords: {
            where: {
              isActive: true,
              ...(ps ? { periodEnd: { gte: ps } } : {}),
              ...(pe ? { periodStart: { lte: pe } } : {}),
            },
            select: { id: true, domain: true, fieldName: true, trustTier: true, periodStart: true, periodEnd: true },
          },
        },
      },
    },
  })

  // Group per supplier, collecting that supplier's grants and de-duplicating its
  // records (a record repeats once per grant of the same grantor).
  type SupplierAcc = { name: string; grants: GrantScope[]; records: Map<string, GapRecord> }
  const bySupplier = new Map<string, SupplierAcc>()
  for (const g of grants) {
    const entry: SupplierAcc = bySupplier.get(g.grantorEntityId) ?? { name: g.grantorEntity.legalName, grants: [], records: new Map() }
    entry.grants.push(toGrantScope(g))
    for (const r of g.grantorEntity.dataRecords) {
      entry.records.set(r.id, { domain: r.domain, fieldName: r.fieldName, trustTier: r.trustTier, periodStart: r.periodStart, periodEnd: r.periodEnd })
    }
    bySupplier.set(g.grantorEntityId, entry)
  }

  // Gaps are computed strictly within each grant's domain/period scope, so a buyer
  // can only see coverage for what they were actually granted.
  const gaps = [...bySupplier.entries()].map(([supplierId, info]) => {
    const { missingDomains, estimatedOnlyDomains } = computeScopedGaps(info.grants, [...info.records.values()], ALL_DOMAINS)
    return { supplierId, supplierName: info.name, missingDomains, estimatedOnlyDomains }
  })

  return NextResponse.json({ periodStart: parsed.data.periodStart ?? null, periodEnd: parsed.data.periodEnd ?? null, gaps })
}
