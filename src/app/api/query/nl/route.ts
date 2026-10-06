// Layer 3 — Natural language query endpoint. Read-only.
//
// The assistant is a three-step pipeline, and only the first and last steps use
// AI: Claude reads the question into structured query parameters, Layer 3
// retrieves the records the user is authorised to see, and Claude reads those
// records back as a plain English answer. The retrieval step in the middle is
// ordinary scoped SQL — the model never touches the database, and no figure in
// the answer comes from anywhere but a stored record.
//
// Trust tier is present on every record in every response, and travels into the
// answer text as well as the table (PRD §20.2).

import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { enforceBuyerApiLimit } from '@/lib/rate-limit-guard'
import { GRANT_SCOPE_SELECT, toGrantScope } from '@/lib/layer3/grant-scope'
import {
  describeScope,
  grantedRecordsWhere,
  resolveSupplierScope,
  supplierGapsWithinGrants,
  type AuthorisedSupplier,
  type SupplierGrant,
} from '@/lib/layer3/nl-query-scope'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseNlQuery } from '@/lib/query-interpreter/nl-parser'
import { composeAnswer, answerWithoutModel } from '@/lib/query-interpreter/answer'
import type { VocabularyEntry } from '@/lib/query-interpreter/field-vocabulary'
import { periodOverlapWhere } from '@/lib/layer3/period-filter'
import type { DataDomain, TrustTier } from '@prisma/client'

const CALCULATION_NOTE =
  'arbor stores the operational data but does not perform this calculation. ' +
  'Here are the records you need to calculate it yourself or pass to your reporting tool.'

export async function POST(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string

  // Each call spends an LLM request — cap per entity to prevent cost abuse.
  const limited = await enforceBuyerApiLimit(entityId)
  if (limited) return limited

  let body: { question?: string }
  try {
    body = await req.json()
  } catch {
    return err('Request body must be JSON', 'VALIDATION_ERROR', 400)
  }

  const question = body.question?.trim()
  if (!question) return err('question is required', 'VALIDATION_ERROR', 400)
  if (question.length > 500) return err('question must be 500 characters or fewer', 'VALIDATION_ERROR', 400)

  // The grants are the whole of what this caller may see of any supplier, and
  // every supplier read below stays inside them — in the query itself.
  const [grantRows, entity] = await Promise.all([
    prisma.dataAccessGrant.findMany({
      where: { granteeEntityId: entityId, isActive: true, revokedAt: null },
      select: {
        grantorEntityId: true,
        grantorEntity: { select: { legalName: true } },
        ...GRANT_SCOPE_SELECT,
      },
    }),
    prisma.entity.findUnique({ where: { id: entityId }, select: { entityType: true } }),
  ])
  const grants: SupplierGrant[] = grantRows.map(g => ({
    grantorEntityId: g.grantorEntityId,
    ...toGrantScope(g),
  }))
  const suppliers: AuthorisedSupplier[] = [
    ...new Map(
      grantRows.map(g => [g.grantorEntityId, { id: g.grantorEntityId, name: g.grantorEntity.legalName }]),
    ).values(),
  ]
  const granted = grantedRecordsWhere(grants)

  // SME suppliers get plain English only; buyers get the full technical vocabulary.
  const plainEnglish = entity?.entityType !== 'BUYER'

  // The field names this caller can actually reach — their own, plus what the
  // suppliers' grants cover. Given to the parser so it chooses from what exists
  // instead of guessing a name that matches no row.
  const vocabularyRows = await prisma.dataRecord.findMany({
    where: { isActive: true, OR: [{ entityId }, ...(granted?.OR ?? [])] },
    select: { domain: true, fieldName: true, unit: true },
    distinct: ['domain', 'fieldName', 'unit'],
    take: 200,
  })
  const vocabulary: VocabularyEntry[] = vocabularyRows

  // Parse the question into structured query parameters
  let parsed
  try {
    parsed = await parseNlQuery(question, vocabulary, suppliers)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Failed to parse question', 'PARSE_ERROR', 422)
  }

  const {
    interpretation,
    isCalculation,
    calculationNote,
    domain,
    fieldName,
    periodStart,
    periodEnd,
    trustTier,
  } = parsed
  const supplier = resolveSupplierScope(parsed, suppliers)
  // A question about one supplier is a question about their shared records,
  // whatever the parser called it.
  const queryType =
    supplier.kind === 'one' && (parsed.queryType === 'entity' || parsed.queryType === 'historical')
      ? 'supply_chain'
      : parsed.queryType
  const scope = describeScope({ queryType, domain, fieldName, periodStart, periodEnd, trustTier, supplier })

  // A named supplier that matches none the caller may see is said so. It used
  // to widen to every supplier and answer about everyone else.
  if (supplier.kind === 'unmatched') {
    const answer = `You have no shared data from a supplier called “${supplier.name}”. Check the name, or ask them to share their records with you.`
    return ok({
      interpretation,
      scope,
      answer,
      isCalculation: false,
      queryType,
      summary: answer,
      recordCount: 0,
      hasMore: false,
      tierDistribution: { A: 0, B: 0, C: 0 },
      records: [],
    })
  }
  const scopedGrants =
    supplier.kind === 'one' ? grants.filter(g => g.grantorEntityId === supplier.id) : grants

  // Execute the appropriate query
  let records: NlRecord[] = []
  let gapResult: GapResult | null = null

  if (queryType === 'gap') {
    gapResult = await runGapQuery({
      entityId,
      domain: domain ?? undefined,
      periodStart,
      periodEnd,
      grants: scopedGrants,
      suppliers: supplier.kind === 'one' ? suppliers.filter(s => s.id === supplier.id) : suppliers,
    })
  } else if (queryType === 'supply_chain') {
    records = await runSupplyChainQuery({
      domain: domain ?? undefined,
      fieldName,
      periodStart,
      periodEnd,
      trustTier: trustTier ?? undefined,
      grants: scopedGrants,
    })
  } else if (queryType === 'historical') {
    records = await runHistoricalQuery({
      entityId,
      domain: domain ?? undefined,
      fieldName,
      periodStart,
      periodEnd,
      trustTier: trustTier ?? undefined,
    })
  } else {
    records = await runEntityQuery({
      entityId,
      domain: domain ?? undefined,
      fieldName,
      periodStart,
      periodEnd,
      trustTier: trustTier ?? undefined,
    })
  }

  const hasMore = records.length > 200
  if (hasMore) records = records.slice(0, 200)

  // Compute trust tier distribution
  const tierDistribution = { A: 0, B: 0, C: 0 }
  for (const r of records) {
    tierDistribution[r.trustTier as 'A' | 'B' | 'C']++
  }

  // Build plain English summary
  const summary = buildSummary(records.length, hasMore, queryType, domain, gapResult)

  // The spoken answer, grounded strictly in the records just retrieved. A model
  // failure degrades to a factual sentence rather than failing the request —
  // the table underneath is the product, and it is already assembled.
  const answer = isCalculation
    ? `${calculationNote ?? CALCULATION_NOTE} ${answerWithoutModel({ recordCount: records.length, interpretation })}`
    : await composeAnswer({
        question,
        interpretation,
        records: records.map(r => ({ ...r, trustTier: r.trustTier as 'A' | 'B' | 'C' })),
        gapResult,
        plainEnglish,
        scope,
      })

  return ok({
    interpretation,
    scope,
    answer,
    isCalculation,
    ...(isCalculation ? { calculationNote: calculationNote ?? CALCULATION_NOTE } : {}),
    queryType,
    summary,
    recordCount: records.length,
    hasMore,
    tierDistribution,
    records,
    ...(gapResult ? { gapResult } : {}),
  })
}

// QUERY RUNNERS

type NlRecord = {
  id: string
  entityName: string
  domain: string
  fieldName: string
  value: number
  unit: string
  periodStart: Date
  periodEnd: Date
  trustTier: string
  confidenceScore: number | null
  sourceText: string | null
  submittedAt: Date
}

type GapResult = {
  ownMissingDomains: string[]
  supplierGaps: Array<{ supplierEntityId: string; supplierName: string; missingDomains: string[] }>
}

const ALL_DOMAINS: DataDomain[] = [
  'ENERGY',
  'MATERIALS',
  'PRODUCTION',
  'LOGISTICS',
  'EMISSIONS',
  'AGRICULTURE',
  'WASTE_AND_WATER',
  'COMPLIANCE',
]

async function runEntityQuery(params: {
  entityId: string
  domain?: DataDomain
  fieldName?: string
  periodStart?: string | null
  periodEnd?: string | null
  trustTier?: TrustTier
}): Promise<NlRecord[]> {
  const { entityId, domain, fieldName, periodStart, periodEnd, trustTier } = params

  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { legalName: true } })
  const entityName = entity?.legalName ?? 'Your organisation'

  const rows = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(fieldName ? { fieldName } : {}),
      ...(trustTier ? { trustTier } : {}),
      ...periodOverlapWhere(periodStart, periodEnd),
    },
    select: {
      id: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      periodStart: true,
      periodEnd: true,
      trustTier: true,
      confidenceScore: true,
      sourceText: true,
      submittedAt: true,
    },
    orderBy: [{ periodEnd: 'desc' }, { domain: 'asc' }],
    take: 201,
  })

  return rows.map(r => ({ ...r, entityName }))
}

async function runSupplyChainQuery(params: {
  domain?: DataDomain
  fieldName?: string
  periodStart?: string | null
  periodEnd?: string | null
  trustTier?: TrustTier
  grants: SupplierGrant[]
}): Promise<NlRecord[]> {
  const { domain, fieldName, periodStart, periodEnd, trustTier, grants } = params

  // Scoped in the query, so the cap applies to records the caller may see.
  // Filtering after a capped read hid in-scope records behind out-of-scope ones
  // and reported the answer as complete.
  const granted = grantedRecordsWhere(grants)
  if (!granted) return []

  const rows = await prisma.dataRecord.findMany({
    where: {
      AND: [
        granted,
        {
          isActive: true,
          ...(domain ? { domain } : {}),
          ...(fieldName ? { fieldName } : {}),
          ...(trustTier ? { trustTier } : {}),
          ...periodOverlapWhere(periodStart, periodEnd),
        },
      ],
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
      submittedAt: true,
      entity: { select: { legalName: true } },
    },
    orderBy: [{ entityId: 'asc' }, { domain: 'asc' }, { periodEnd: 'desc' }],
    take: 201,
  })

  return rows.map(r => ({
    id: r.id,
    entityName: r.entity.legalName,
    domain: r.domain,
    fieldName: r.fieldName,
    value: r.value,
    unit: r.unit,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    trustTier: r.trustTier,
    confidenceScore: r.confidenceScore,
    sourceText: r.sourceText,
    submittedAt: r.submittedAt,
  }))
}

async function runHistoricalQuery(params: {
  entityId: string
  domain?: DataDomain
  fieldName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  trustTier?: TrustTier
}): Promise<NlRecord[]> {
  const { entityId, domain, fieldName, periodStart, periodEnd, trustTier } = params

  const entity = await prisma.entity.findUnique({ where: { id: entityId }, select: { legalName: true } })
  const entityName = entity?.legalName ?? 'Your organisation'

  const rows = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...(fieldName ? { fieldName } : {}),
      // Parsed and then dropped, once: "verified energy in 2025" returned every
      // energy record of any status from any year.
      ...(trustTier ? { trustTier } : {}),
      ...periodOverlapWhere(periodStart, periodEnd),
    },
    select: {
      id: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      periodStart: true,
      periodEnd: true,
      trustTier: true,
      confidenceScore: true,
      sourceText: true,
      submittedAt: true,
    },
    orderBy: { periodStart: 'asc' },
    take: 201,
  })

  return rows.map(r => ({ ...r, entityName }))
}

async function runGapQuery(params: {
  entityId: string
  domain?: DataDomain
  periodStart?: string | null
  periodEnd?: string | null
  grants: SupplierGrant[]
  suppliers: AuthorisedSupplier[]
}): Promise<GapResult> {
  const { entityId, domain, periodStart, periodEnd, grants, suppliers } = params

  const ownRecords = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(domain ? { domain } : {}),
      ...periodOverlapWhere(periodStart, periodEnd),
    },
    select: { domain: true },
  })

  const coveredDomains = new Set(ownRecords.map(r => r.domain))
  const targetDomains = domain ? [domain] : ALL_DOMAINS
  const ownMissingDomains = targetDomains.filter(d => !coveredDomains.has(d))

  // A gap is a statement about a supplier's data, so it is made only from the
  // records the grants cover and only about areas they cover. Checked against
  // the grant's existence alone, it told a buyer granted energy which other
  // areas the supplier had records in.
  const granted = grantedRecordsWhere(grants)
  const supplierRecords = granted
    ? await prisma.dataRecord.findMany({
        where: {
          AND: [
            granted,
            { isActive: true, ...(domain ? { domain } : {}), ...periodOverlapWhere(periodStart, periodEnd) },
          ],
        },
        select: { entityId: true, domain: true },
        distinct: ['entityId', 'domain'],
      })
    : []

  const covered = new Map<string, Set<string>>()
  for (const r of supplierRecords) {
    if (!covered.has(r.entityId)) covered.set(r.entityId, new Set())
    covered.get(r.entityId)!.add(r.domain)
  }

  return {
    ownMissingDomains,
    supplierGaps: supplierGapsWithinGrants({ suppliers, grants, covered, targetDomains }),
  }
}

// SUMMARY BUILDER

function buildSummary(
  count: number,
  hasMore: boolean,
  queryType: QueryType,
  domain: string | undefined | null,
  gapResult: GapResult | null,
): string {
  const DOMAIN_LABELS: Record<string, string> = {
    ENERGY: 'energy',
    MATERIALS: 'materials',
    PRODUCTION: 'production',
    LOGISTICS: 'logistics',
    EMISSIONS: 'emissions',
    AGRICULTURE: 'agriculture',
    WASTE_AND_WATER: 'waste and water',
    COMPLIANCE: 'compliance',
  }

  if (queryType === 'gap' && gapResult) {
    const totalGaps =
      gapResult.ownMissingDomains.length +
      gapResult.supplierGaps.reduce((n, g) => n + g.missingDomains.length, 0)
    return totalGaps === 0
      ? 'No gaps found — all expected domains have records.'
      : `Found ${totalGaps} data gap${totalGaps === 1 ? '' : 's'} across your organisation and supplier network.`
  }

  if (count === 0) {
    return domain
      ? `No ${DOMAIN_LABELS[domain] ?? domain} records found for this query.`
      : 'No records found for this query.'
  }

  const domainLabel = domain ? ` ${DOMAIN_LABELS[domain] ?? domain}` : ''
  const scope = queryType === 'supply_chain' ? ' across your supplier network' : ''
  const moreNote = hasMore ? ' (showing first 200 — narrow your question for more specific results)' : ''
  return `Found ${hasMore ? 'more than 200' : count}${domainLabel} record${count === 1 ? '' : 's'}${scope}.${moreNote}`
}

type QueryType = 'entity' | 'supply_chain' | 'gap' | 'historical'
