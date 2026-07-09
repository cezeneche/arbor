import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { enforceBuyerApiLimit } from '@/lib/rate-limit-guard'
import { anyGrantCoversRecord } from '@/lib/layer3/grant-scope'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { domainSchema, tierSchema, ALL_DOMAINS } from '@/lib/constants'
import type { DataDomain, TrustTier } from '@prisma/client'

// Layer 3 — Relational Query Engine. Read-only. No modification of stored data.
// PRD Section 15 — entity, supply-chain, gap, and historical query types.
// Trust tier is always visible on every record in every result.

type QueryType = 'entity' | 'supply_chain' | 'gap' | 'historical'

export async function GET(req: NextRequest) {
  let entityId: string | null = null

  const apiKeyAuth = await authenticateApiKeyRequest(req)
  if (apiKeyAuth.authorized) {
    entityId = apiKeyAuth.entityId!
  } else {
    const { session, response } = await requireAuth()
    if (!session) return response!
    entityId = getSessionUser(session).entityId as string
  }

  const limited = await enforceBuyerApiLimit(entityId)
  if (limited) return limited

  const { searchParams } = req.nextUrl
  const queryType = (searchParams.get('type') ?? 'entity') as QueryType

  const domainParam = searchParams.get('domain')
  const tierParam = searchParams.get('trustTier')

  if (domainParam) {
    const result = domainSchema.safeParse(domainParam)
    if (!result.success) return err(`Invalid domain '${domainParam}'`, 'VALIDATION_ERROR', 400)
  }
  if (tierParam) {
    const result = tierSchema.safeParse(tierParam)
    if (!result.success) return err(`Invalid trustTier '${tierParam}'`, 'VALIDATION_ERROR', 400)
  }

  const domain = domainParam ? domainSchema.parse(domainParam) : undefined
  const trustTier = tierParam ? tierSchema.parse(tierParam) : undefined

  const fieldName = searchParams.get('fieldName') ?? undefined
  const periodStart = searchParams.get('periodStart') ?? undefined
  const periodEnd = searchParams.get('periodEnd') ?? undefined
  const documentId = searchParams.get('documentId') ?? undefined
  const supplierEntityId = searchParams.get('supplierEntityId') ?? undefined

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

// ── ENTITY QUERY ──────────────────────────────────────────────────────────────

async function handleEntityQuery(params: {
  entityId: string
  domain?: DataDomain
  fieldName?: string
  periodStart?: string
  periodEnd?: string
  trustTier?: TrustTier
  documentId?: string
}) {
  const { entityId, domain, fieldName, periodStart, periodEnd, trustTier, documentId } = params

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(fieldName ? { fieldName } : {}),
      ...(trustTier ? { trustTier } : {}),
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
        select: { flagType: true, severity: true, message: true, resolvedAt: true },
      },
    },
    orderBy: [{ periodEnd: 'desc' }, { domain: 'asc' }],
  })

  return ok({ type: 'entity', count: records.length, records })
}

// ── SUPPLY CHAIN QUERY ────────────────────────────────────────────────────────

async function handleSupplyChainQuery(params: {
  buyerEntityId: string
  domain?: DataDomain
  fieldName?: string
  periodStart?: string
  periodEnd?: string
  trustTier?: TrustTier
  supplierEntityId?: string
}) {
  const { buyerEntityId, domain, fieldName, periodStart, periodEnd, trustTier, supplierEntityId } = params

  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      granteeEntityId: buyerEntityId,
      isActive: true,
      revokedAt: null,
      ...(supplierEntityId ? { grantorEntityId: supplierEntityId } : {}),
      ...(domain ? { OR: [{ domain }, { domain: null }] } : {}),
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

  const authorisedEntityIds = [...new Set(grants.map(g => g.grantorEntityId))]

  const records = await prisma.dataRecord.findMany({
    where: {
      entityId: { in: authorisedEntityIds },
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(fieldName ? { fieldName } : {}),
      ...(trustTier ? { trustTier } : {}),
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

  const filteredRecords = records.filter(record =>
    anyGrantCoversRecord(grants.filter(g => g.grantorEntityId === record.entityId), record),
  )

  const supplierCount = new Set(filteredRecords.map(r => r.entityId)).size

  return ok({ type: 'supply_chain', count: filteredRecords.length, supplierCount, records: filteredRecords })
}

// ── GAP QUERY ─────────────────────────────────────────────────────────────────

async function handleGapQuery(params: {
  entityId: string
  domain?: DataDomain
  periodStart?: string
  periodEnd?: string
}) {
  const { entityId, domain, periodStart, periodEnd } = params

  const ownRecords = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(periodStart ? { periodStart: { gte: new Date(periodStart) } } : {}),
      ...(periodEnd ? { periodEnd: { lte: new Date(periodEnd) } } : {}),
    },
    select: { domain: true },
  })

  const coveredDomains = new Set(ownRecords.map(r => r.domain))
  const targetDomains = domain ? [domain] : ALL_DOMAINS
  const missingDomains = (targetDomains as DataDomain[]).filter(d => !coveredDomains.has(d))

  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      granteeEntityId: entityId,
      isActive: true,
      revokedAt: null,
      ...(domain ? { OR: [{ domain }, { domain: null }] } : {}),
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
        ...(domain ? { domain } : {}),
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

    for (const sid of authorisedEntityIds) {
      const entityGrants = grants.filter(g => g.grantorEntityId === sid)
      const supplierName = entityGrants[0].grantorEntity.legalName
      const grantedDomains = domain
        ? [domain]
        : (entityGrants.map(g => g.domain).filter(Boolean) as DataDomain[])

      const covered = supplierCoverage.get(sid) ?? new Set()
      const missing = (grantedDomains.length > 0 ? grantedDomains : (ALL_DOMAINS as DataDomain[])).filter(d => !covered.has(d))

      if (missing.length > 0) {
        supplierGaps.push({ supplierEntityId: sid, supplierName, missingDomains: missing })
      }
    }
  }

  return ok({ type: 'gap', ownMissingDomains: missingDomains, supplierGaps })
}

// ── HISTORICAL QUERY ──────────────────────────────────────────────────────────

async function handleHistoricalQuery(params: {
  entityId: string
  domain?: DataDomain
  fieldName?: string
}) {
  const { entityId, domain, fieldName } = params

  if (!domain || !fieldName) {
    return err('Historical queries require both domain and fieldName parameters', 'VALIDATION_ERROR', 400)
  }

  const records = await prisma.dataRecord.findMany({
    where: { entityId, isActive: true, domain, fieldName },
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

  return ok({ type: 'historical', domain, fieldName, count: records.length, records })
}
