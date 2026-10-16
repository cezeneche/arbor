import 'server-only'
import { prisma } from '@/lib/prisma'
import { DOMAIN_BY_DOCUMENT_TYPE, type DataDomain } from '@/lib/constants'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { fieldLabel } from './field-label'
import { buildDashboard, dashboardDate, recordHref, requestHref } from './dashboard'

export async function loadDashboard(entityId: string, userId: string, now: Date) {
  const [
    entity,
    documents,
    requests,
    flags,
    stewards,
    members,
    inbound,
    handoffs,
    groups,
    shares,
    processingCount,
  ] = await Promise.all([
    prisma.entity.findUnique({
      where: { id: entityId },
      select: { legalName: true, entityType: true, cbamEnabled: true },
    }),
    prisma.document.findMany({
      where: {
        entityId,
        OR: [
          { status: { in: ['REVIEW_REQUIRED', 'REJECTED'] } },
          { status: 'ACCEPTED', autoAcceptedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        fileName: true,
        documentType: true,
        status: true,
        autoAcceptedAt: true,
        submittedById: true,
        submittedAt: true,
      },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.dataRequest.findMany({
      where: {
        status: { in: ['PENDING', 'QUERY_RAISED', 'SUBMITTED'] },
        OR: [{ buyerEntityId: entityId }, { supplierEntityId: entityId }],
      },
      select: {
        id: true,
        domain: true,
        periodStart: true,
        periodEnd: true,
        requiredFields: true,
        deadline: true,
        status: true,
        buyerEntityId: true,
        requestedById: true,
        requestedBy: { select: { name: true } },
        buyerEntity: { select: { legalName: true } },
        supplierEntity: { select: { legalName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.validationFlag.findMany({
      where: { resolvedAt: null, dataRecord: { entityId, isActive: true } },
      select: {
        id: true,
        message: true,
        severity: true,
        assigneeId: true,
        dueAt: true,
        assignee: { select: { name: true, isActive: true } },
        dataRecord: { select: { id: true, domain: true, fieldName: true } },
      },
    }),
    prisma.domainSteward.findMany({
      where: { entityId, user: { isActive: true, role: { in: ['ADMIN', 'CONTRIBUTOR'] } } },
      select: { domain: true, userId: true, user: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { entityId, isActive: true, role: { in: ['ADMIN', 'CONTRIBUTOR'] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inboundRequest.findMany({
      where: { entityId, status: { not: 'ANSWERED' } },
      select: { id: true, fromEmail: true, status: true, parsedFields: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.cbamCaseLink.findMany({
      where: { entityId },
      select: {
        id: true,
        documentId: true,
        nucleosCaseId: true,
        status: true,
        document: { select: { fileName: true, submittedById: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.dataRecord.groupBy({
      by: ['domain', 'trustTier'],
      where: { entityId, isActive: true },
      _count: { _all: true },
      _max: { periodEnd: true },
    }),
    prisma.sharedExport.findMany({
      where: { entityId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { id: true, domain: true, expiresAt: true, isSnapshot: true },
      orderBy: { expiresAt: 'asc' },
    }),
    prisma.document.count({ where: { entityId, status: { in: ['PENDING', 'EXTRACTING'] } } }),
  ])
  if (!entity) return null
  const memberName = new Map(members.map(m => [m.id, m.name]))
  const normalRequests = requests.map(r => ({
    ...r,
    direction: r.buyerEntityId === entityId ? ('outgoing' as const) : ('incoming' as const),
    counterparty: r.buyerEntityId === entityId ? r.supplierEntity.legalName : r.buyerEntity.legalName,
    requestedByName: r.requestedBy.name,
    requiredFields: Array.isArray(r.requiredFields)
      ? r.requiredFields.filter((f): f is string => typeof f === 'string')
      : [],
  }))
  const incoming = normalRequests.filter(r => r.direction === 'incoming' && r.status !== 'SUBMITTED')
  // Load only records that can answer current incoming requests, across their
  // actual periods. Organisation totals stay aggregated by the database.
  const records = incoming.length
    ? await prisma.dataRecord.findMany({
        where: {
          entityId,
          isActive: true,
          OR: incoming.map(r => ({
            domain: r.domain,
            periodStart: { lte: r.periodEnd },
            periodEnd: { gte: r.periodStart },
          })),
        },
        select: {
          id: true,
          domain: true,
          fieldName: true,
          periodStart: true,
          periodEnd: true,
          trustTier: true,
          staleAfterDate: true,
          validationFlags: { where: { resolvedAt: null, severity: 'CRITICAL' }, select: { id: true } },
        },
      })
    : []
  const model = buildDashboard({
    now,
    userId,
    requests: normalRequests,
    records: records.map(r => ({ ...r, critical: r.validationFlags.length > 0 })),
    documents: documents.map(d => ({
      ...d,
      domain: DOMAIN_BY_DOCUMENT_TYPE[d.documentType] ?? 'COMPLIANCE',
      autoAccepted: Boolean(d.autoAcceptedAt),
      submittedByName: memberName.get(d.submittedById) ?? 'Document submitter',
    })),
    flags: flags.map(f => ({
      ...f,
      recordId: f.dataRecord.id,
      domain: f.dataRecord.domain,
      fieldName: f.dataRecord.fieldName,
      assigneeId: f.assignee?.isActive ? f.assigneeId : null,
      assigneeName: f.assignee?.isActive ? f.assignee.name : null,
    })),
    stewards: stewards.map(s => ({ domain: s.domain, userId: s.userId, name: s.user.name })),
    inbound: inbound.map(r => ({
      id: r.id,
      fromEmail: r.fromEmail,
      status: r.status,
      ready: Boolean(
        r.parsedFields &&
        typeof r.parsedFields === 'object' &&
        !Array.isArray(r.parsedFields) &&
        r.parsedFields.awaiting === 'supplier_review',
      ),
    })),
    handoffs: handoffs.map(h => ({
      id: h.id,
      documentId: h.documentId,
      fileName: h.document.fileName,
      submittedById: h.document.submittedById,
      submittedByName: memberName.get(h.document.submittedById) ?? 'Document submitter',
      status: h.status,
      caseId: h.nucleosCaseId,
    })),
  })
  const domains = [...new Set(groups.map(g => g.domain))]
    .map(domain => {
      const own = groups.filter(g => g.domain === domain)
      return {
        domain,
        label: DOMAIN_LABELS[domain],
        count: own.reduce((n, g) => n + g._count._all, 0),
        latestPeriod: own.reduce<Date | null>(
          (last, g) => (g._max.periodEnd && (!last || g._max.periodEnd > last) ? g._max.periodEnd : last),
          null,
        ),
        verified: own.find(g => g.trustTier === 'A')?._count._all ?? 0,
        declared: own.find(g => g.trustTier === 'B')?._count._all ?? 0,
        estimated: own.find(g => g.trustTier === 'C')?._count._all ?? 0,
      }
    })
    .sort((a, b) => (b.latestPeriod?.getTime() ?? 0) - (a.latestPeriod?.getTime() ?? 0))
  return {
    ...model,
    entity,
    members,
    domains,
    processingCount,
    shares,
    reviewCount: documents.filter(d => d.status === 'REVIEW_REQUIRED' || d.autoAcceptedAt).length,
    caseCount: new Set(handoffs.map(h => h.nucleosCaseId).filter(Boolean)).size,
    unfinishedCases: handoffs.filter(h => h.status !== 'CREATED').length,
    showCbam: entity.cbamEnabled || handoffs.length > 0,
  }
}

export interface DashboardSearchResult {
  id: string
  title: string
  detail: string
  href: string
  kind: string
}

export async function searchDashboard(entityId: string, raw: string): Promise<DashboardSearchResult[]> {
  const query = raw.trim().slice(0, 120)
  if (!query) return []
  const matchingDomains = Object.entries(DOMAIN_LABELS)
    .filter(([key, label]) => `${key} ${label}`.toLowerCase().includes(query.toLowerCase()))
    .map(([key]) => key as DataDomain)
  const [records, documents, requests] = await Promise.all([
    prisma.dataRecord.findMany({
      where: {
        entityId,
        isActive: true,
        OR: [
          { fieldName: { contains: query.replace(/\s+/g, '_'), mode: 'insensitive' } },
          { document: { fileName: { contains: query, mode: 'insensitive' } } },
          ...(matchingDomains.length ? [{ domain: { in: matchingDomains } }] : []),
        ],
      },
      select: {
        id: true,
        fieldName: true,
        domain: true,
        periodStart: true,
        periodEnd: true,
        trustTier: true,
      },
      orderBy: { submittedAt: 'desc' },
      take: 12,
    }),
    prisma.document.findMany({
      where: { entityId, status: { not: 'WITHDRAWN' }, fileName: { contains: query, mode: 'insensitive' } },
      select: { id: true, fileName: true, status: true },
      orderBy: { submittedAt: 'desc' },
      take: 12,
    }),
    prisma.dataRequest.findMany({
      where: {
        AND: [
          { OR: [{ buyerEntityId: entityId }, { supplierEntityId: entityId }] },
          {
            OR: [
              { buyerEntity: { legalName: { contains: query, mode: 'insensitive' } } },
              { supplierEntity: { legalName: { contains: query, mode: 'insensitive' } } },
              ...(matchingDomains.length ? [{ domain: { in: matchingDomains } }] : []),
            ],
          },
        ],
      },
      select: {
        id: true,
        buyerEntityId: true,
        buyerEntity: { select: { legalName: true } },
        supplierEntity: { select: { legalName: true } },
        domain: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
  ])
  return [
    ...records.map(r => ({
      id: `record-${r.id}`,
      title: fieldLabel(r.fieldName, r.domain),
      kind: 'Stored record',
      detail: `${dashboardDate(r.periodStart)} – ${dashboardDate(r.periodEnd)} · ${{ A: 'Verified', B: 'Declared', C: 'Estimated' }[r.trustTier]}`,
      href: recordHref(r.id),
    })),
    ...documents.map(d => ({
      id: `document-${d.id}`,
      title: d.fileName,
      kind: 'Document',
      detail: {
        PENDING: 'Waiting to be read',
        EXTRACTING: 'Being read',
        REVIEW_REQUIRED: 'Needs review',
        ACCEPTED: 'Accepted',
        REJECTED: 'Needs attention',
        WITHDRAWN: 'Withdrawn',
      }[d.status],
      href: `/upload/${encodeURIComponent(d.id)}/review`,
    })),
    ...requests.map(r => ({
      id: `request-${r.id}`,
      title: r.buyerEntityId === entityId ? r.supplierEntity.legalName : r.buyerEntity.legalName,
      kind: r.buyerEntityId === entityId ? 'Sent request' : 'Incoming request',
      detail: DOMAIN_LABELS[r.domain],
      href: requestHref(r.id),
    })),
  ]
}
