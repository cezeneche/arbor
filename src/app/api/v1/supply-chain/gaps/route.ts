import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { ALL_DOMAINS } from '@/lib/constants'

const querySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

// Gap 6.1 — buyer API: which supplier+domain combinations have no records, or
// only Tier C (estimated) records, for the requested period.
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get('authorization'))
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
      grantorEntity: {
        select: {
          legalName: true,
          dataRecords: {
            where: {
              isActive: true,
              ...(ps ? { periodEnd: { gte: ps } } : {}),
              ...(pe ? { periodStart: { lte: pe } } : {}),
            },
            select: { domain: true, trustTier: true },
          },
        },
      },
    },
  })

  const bySupplier = new Map<string, { name: string; records: { domain: string; trustTier: string }[] }>()
  for (const g of grants) {
    const entry = bySupplier.get(g.grantorEntityId) ?? { name: g.grantorEntity.legalName, records: [] }
    entry.records.push(...g.grantorEntity.dataRecords)
    bySupplier.set(g.grantorEntityId, entry)
  }

  const gaps = [...bySupplier.entries()].map(([supplierId, info]) => {
    const missing: string[] = []
    const estimatedOnly: string[] = []
    for (const domain of ALL_DOMAINS) {
      const domainRecords = info.records.filter((r) => r.domain === domain)
      if (domainRecords.length === 0) {
        missing.push(domain)
      } else if (domainRecords.every((r) => r.trustTier === 'C')) {
        estimatedOnly.push(domain)
      }
    }
    return { supplierId, supplierName: info.name, missingDomains: missing, estimatedOnlyDomains: estimatedOnly }
  })

  return NextResponse.json({ periodStart: parsed.data.periodStart ?? null, periodEnd: parsed.data.periodEnd ?? null, gaps })
}
