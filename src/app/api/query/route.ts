import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// Layer 3  -  Relational Query Engine. Read-only. No modification of stored data.
// PRD Section 15  -  entity, supply-chain, gap, and historical query types.
// Trust tier is always visible on every record in every result.

type QueryType = 'entity' | 'supply_chain' | 'gap' | 'historical'

const VALID_DOMAINS = ['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']
const VALID_TIERS = ['A', 'B', 'C']

export async function GET(req: NextRequest) {
  let entityId: string | null = null

  const apiKeyAuth = await authenticateApiKey(req.headers.get('authorization'))
  if (apiKeyAuth.authorized) {
    entityId = apiKeyAuth.entityId!
  } else {
    const { session, response } = await requireAuth()
    if (!session) return response!
    entityId = (session.user as Record<string, unknown>).entityId as string
  }

  const { searchParams } = req.nextUrl
  const queryType = (searchParams.get('type') ?? 'entity') as QueryType
  const domain = searchParams.get('domain') ?? undefined
  const fieldName = searchParams.get('fieldName') ?? undefined
  const periodStart = searchParams.get('periodStart') ?? undefined
  const periodEnd = searchParams.get('periodEnd') ?? undefined
  const trustTier = searchParams.get('trustTier') ?? undefined
  const documentId = searchParams.get('documentId') ?? undefined
  const supplierEntityId = searchParams.get('supplierEntityId') ?? undefined

  if (domain && !VALID_DOMAINS.includes(domain)) {
    return err(`Invalid domain '${domain}'`, 'VALIDATION_ERROR', 400)
  }
  if (trustTier && !VALID_TIERS.includes(trustTier)) {
    return err(`Invalid trustTier '${trustTier}'`, 'VALIDATION_ERROR', 400)
  }

  switch (queryType) {
    case 'entity':
      return handleEntityQuery({ entityId, domain, fieldName, periodStart, periodEnd, trustTier, documentId })

    case 'supply_chain':
      return handleSupplyChainQuery({ buyerEntityId: entityId, domain, fieldName, periodStart, periodEnd, trustTier, supplierEntityId })

    case 'gap':
      return handleGapQuery({ entityId, domain, periodStart, periodEnd })

    case 'historical':
      return handleHistoricalQuery({ entityId, domain, fieldName })

    default:
      return err(`Invalid query type '${queryType}'. Valid types: entity, supply_chain, gap, historical`, 'VALIDATION_ERROR', 400)
  }
}

// ── ENTITY QUERY ─────────────────────────────────────────────────────────────
// Returns records owned by the requesting entity, with full provenance.

async function handleEntityQuery(params: {
  entityId: string
  domain?: string
  fieldName?: string
  periodStart?: string
  periodEnd?: string
  trustTier?: string
  documentId?: string
}) {
  const { entityId, domain, fieldName, periodStart, periodEnd, trustTier, documentId } = params

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain: domain as never } : {}),
      ...(fieldName ? { fieldName } : {}),
      ...(trustTier ? { trustTier: trustTier as never } : {}),
      ...(documentId ? { documentId } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    select: {
      id: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      originalValue: true,
      originalUnit: true,
      periodStart: true,
      periodEnd: true,
      trustTier: true,
      confidenceScore: true,
      sourceText: true,
      extractionMethod: true,
      submittedAt: true,
      documentId: true,
      isActive: true,
      validationFlags: {
        select: {
          flagType: true,
          severity: true,
          message: true,
          resolvedAt: true,
        },
      },
    },
    orderBy: [{ periodEnd: 'desc' }, { domain: 'asc' }],
  })

  return ok({ type: 'entity', count: records.length, records })
}

// ── SUPPLY CHAIN QUERY ────────────────────────────────────────────────────────
// Returns records from authorised supplier relationships.
// A buyer can only query supplier data the supplier has explicitly shared with them.

async function handleSupplyChainQuery(params: {
  buyerEntityId: string
  domain?: string
  fieldName?: string
  periodStart?: string
  periodEnd?: string
  trustTier?: string
  supplierEntityId?: string
}) {
  const { buyerEntityId, domain, fieldName, periodStart, periodEnd, trustTier, supplierEntityId } = params

  // Fetch all active grants where this entity is the grantee (buyer)
  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      granteeEntityId: buyerEntityId,
      isActive: true,
      revokedAt: null,
      ...(supplierEntityId ? { grantorEntityId: supplierEntityId } : {}),
      ...(domain ? { OR: [{ domain: domain as never }, { domain: null }] } : {}),
    },
    select: {
      grantorEntityId: true,
      domain: true,
      periodStart: true,
      periodEnd: true,
      grantorEntity: { select: { legalName: true } },
    },
  })

  if (grants.length === 0) {
    return ok({ type: 'supply_chain', count: 0, records: [], supplierCount: 0 })
  }

  // Build a combined where clause that respects each grant's scope
  const authorisedEntityIds = [...new Set(grants.map(g => g.grantorEntityId))]

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId: { in: authorisedEntityIds },
      isActive: true,
      ...(domain ? { domain: domain as never } : {}),
      ...(fieldName ? { fieldName } : {}),
      ...(trustTier ? { trustTier: trustTier as never } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    select: {
      id: true,
      entityId: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      periodStart: true,
      periodEnd: true,
      trustTier: true,
      confidenceScore: true,
      sourceText: true,
      extractionMethod: true,
      submittedAt: true,
      documentId: true,
      entity: { select: { legalName: true } },
    },
    orderBy: [{ entityId: 'asc' }, { domain: 'asc' }, { periodEnd: 'desc' }],
  })

  // Filter: each record must be within the scope of at least one grant for that entity
  const filteredRecords = records.filter(record => {
    const entityGrants = grants.filter(g => g.grantorEntityId === record.entityId)
    return entityGrants.some(grant => {
      const domainMatch = !grant.domain || grant.domain === record.domain
      const startMatch = !grant.periodStart || record.periodEnd >= grant.periodStart
      const endMatch = !grant.periodEnd || record.periodStart <= grant.periodEnd
      return domainMatch && startMatch && endMatch
    })
  })

  const supplierCount = new Set(filteredRecords.map(r => r.entityId)).size

  return ok({
    type: 'supply_chain',
    count: filteredRecords.length,
    supplierCount,
    records: filteredRecords,
  })
}

// ── GAP QUERY ─────────────────────────────────────────────────────────────────
// Identifies which domain+period combinations have no records.
// For buyers: which authorised suppliers have not submitted for a given domain+period.

async function handleGapQuery(params: {
  entityId: string
  domain?: string
  periodStart?: string
  periodEnd?: string
}) {
  const { entityId, domain, periodStart, periodEnd } = params

  // Own entity gaps
  const ownRecords = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain: domain as never } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    select: { domain: true, periodStart: true, periodEnd: true },
  })

  const coveredDomains = [...new Set(ownRecords.map(r => r.domain))]
  const allDomains = domain ? [domain] : ['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']
  const missingDomains = allDomains.filter(d => !coveredDomains.includes(d as never))

  // Buyer supply chain gaps: suppliers with active grants who have not submitted
  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      granteeEntityId: entityId,
      isActive: true,
      revokedAt: null,
      ...(domain ? { OR: [{ domain: domain as never }, { domain: null }] } : {}),
    },
    select: {
      grantorEntityId: true,
      domain: true,
      grantorEntity: { select: { legalName: true } },
    },
  })

  const supplierGaps: Array<{ supplierEntityId: string; supplierName: string; missingDomains: string[] }> = []

  if (grants.length > 0) {
    const authorisedEntityIds = [...new Set(grants.map(g => g.grantorEntityId))]

    const supplierRecords = await prisma.dataRecord.findMany({
      where: {
        entityId: { in: authorisedEntityIds },
        isActive: true,
        ...(domain ? { domain: domain as never } : {}),
        ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
        ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
      },
      select: { entityId: true, domain: true },
    })

    const supplierCoverage = new Map<string, Set<string>>()
    for (const r of supplierRecords) {
      if (!supplierCoverage.has(r.entityId)) supplierCoverage.set(r.entityId, new Set())
      supplierCoverage.get(r.entityId)!.add(r.domain)
    }

    for (const entityGrantId of authorisedEntityIds) {
      const entityGrants = grants.filter(g => g.grantorEntityId === entityGrantId)
      const supplierName = entityGrants[0].grantorEntity.legalName
      const grantedDomains = domain
        ? [domain]
        : entityGrants.map(g => g.domain).filter(Boolean) as string[]

      const covered = supplierCoverage.get(entityGrantId) ?? new Set()
      const missing = (grantedDomains.length > 0 ? grantedDomains : allDomains).filter(d => !covered.has(d))

      if (missing.length > 0) {
        supplierGaps.push({ supplierEntityId: entityGrantId, supplierName, missingDomains: missing })
      }
    }
  }

  return ok({
    type: 'gap',
    ownMissingDomains: missingDomains,
    supplierGaps,
  })
}

// ── HISTORICAL QUERY ──────────────────────────────────────────────────────────
// Returns period-over-period values for a given domain+fieldName.
// Presented as ordered data points  -  no aggregation or calculation applied.

async function handleHistoricalQuery(params: {
  entityId: string
  domain?: string
  fieldName?: string
}) {
  const { entityId, domain, fieldName } = params

  if (!domain || !fieldName) {
    return err('Historical queries require both domain and fieldName parameters', 'VALIDATION_ERROR', 400)
  }

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      domain: domain as never,
      fieldName,
    },
    select: {
      id: true,
      value: true,
      unit: true,
      trustTier: true,
      confidenceScore: true,
      periodStart: true,
      periodEnd: true,
      submittedAt: true,
      documentId: true,
    },
    orderBy: { periodStart: 'asc' },
  })

  return ok({
    type: 'historical',
    domain,
    fieldName,
    count: records.length,
    records,
  })
}
