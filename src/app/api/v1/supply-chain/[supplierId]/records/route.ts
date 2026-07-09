import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { logRecordAccess } from '@/lib/layer3/grant-access'
import { domainSchema } from '@/lib/constants'

const querySchema = z.object({
  domain: domainSchema.optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  trustTier: z.enum(['A', 'B', 'C']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
})

// buyer API: paginated records for a supplier the caller has been
// granted access to. Returns 403 without an active grant. Logs API access.
export async function GET(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  const auth = await authenticateApiKeyRequest(req)
  if (!auth.authorized || !auth.entityId) {
    return NextResponse.json({ error: auth.reason ?? 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  const buyerEntityId = auth.entityId
  const { supplierId } = await params

  const { allowed } = await checkRateLimit(RATE_LIMITS.buyerApi, buyerEntityId)
  if (!allowed) return NextResponse.json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' }, { status: 429 })

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const { domain, periodStart, periodEnd, trustTier, page, pageSize } = parsed.data

  const grants = await prisma.dataAccessGrant.findMany({
    where: { grantorEntityId: supplierId, granteeEntityId: buyerEntityId, isActive: true, revokedAt: null },
    select: { domain: true, periodStart: true, periodEnd: true },
  })
  if (grants.length === 0) {
    return NextResponse.json({ error: 'No active data access grant for this supplier', code: 'FORBIDDEN' }, { status: 403 })
  }

  // Pull candidate records then enforce the union of grant scopes in memory.
  const candidates = await prisma.dataRecord.findMany({
    where: {
      entityId: supplierId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(trustTier ? { trustTier } : {}),
      ...(periodStart ? { periodEnd: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodStart: { lte: new Date(periodEnd) } } : {}),
    },
    orderBy: [{ domain: 'asc' }, { periodStart: 'desc' }],
  })

  const scoped = candidates.filter((record) =>
    grants.some((grant) => {
      const domainMatch = !grant.domain || grant.domain === record.domain
      const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
      const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
      return domainMatch && startMatch && endMatch
    }),
  )

  const total = scoped.length
  const start = (page - 1) * pageSize
  const pageRecords = scoped.slice(start, start + pageSize)

  // log API access to the returned records.
  await logRecordAccess(pageRecords.map((r) => r.id), buyerEntityId, 'API')

  return NextResponse.json({
    supplierId,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    records: pageRecords.map((r) => ({
      id: r.id,
      domain: r.domain,
      fieldName: r.fieldName,
      value: r.value,
      unit: r.unit,
      originalValue: r.originalValue,
      originalUnit: r.originalUnit,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      trustTier: r.trustTier,
      confidenceScore: r.confidenceScore,
      sourceText: r.sourceText,
      extractionMethod: r.extractionMethod,
      documentId: r.documentId,
      auditHash: r.auditHash,
    })),
  })
}
