// Offline property-graph projection job. Scheduled worker (Vercel Cron).
//
// Reads a consistent snapshot of the relational store, projects it into typed
// nodes + edges (pure `projectGraph`), and replaces the GraphNode/GraphEdge
// tables. A derived view rebuilt off any write path — never a second source of
// truth in the Layer 2 critical section, and it touches no certified data.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if
// the secret is unset.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { projectGraph, type GraphProjectionInput } from '@/lib/graph/project'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CAP = 20000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  // 1. Snapshot the relationship-bearing rows.
  const [entities, documents, records, sameAsLinks, requests] = await Promise.all([
    prisma.entity.findMany({
      select: { id: true, legalName: true, entityType: true, country: true, sector: true },
      take: CAP,
    }),
    prisma.document.findMany({
      select: { id: true, entityId: true, documentType: true, fileName: true },
      take: CAP,
    }),
    prisma.dataRecord.findMany({
      where: { isActive: true },
      select: { id: true, entityId: true, documentId: true, domain: true, fieldName: true },
      take: CAP,
    }),
    // Only human-confirmed identity links become graph edges.
    prisma.entityLink.findMany({
      where: { status: 'CONFIRMED' },
      select: { entityAId: true, entityBId: true },
      take: CAP,
    }),
    // A buyer requesting data from a supplier is a supply relationship.
    prisma.dataRequest.findMany({
      select: { buyerEntityId: true, supplierEntityId: true },
      take: CAP,
    }),
  ])

  const input: GraphProjectionInput = {
    entities,
    documents,
    records,
    sameAs: sameAsLinks,
    supplies: requests.map(r => ({ supplierEntityId: r.supplierEntityId, buyerEntityId: r.buyerEntityId })),
  }
  const { nodes, edges } = projectGraph(input)

  // 2. Replace the graph atomically. Edges cascade on node delete, but we clear
  //    both explicitly for a clean, order-independent rebuild.
  await prisma.$transaction([
    prisma.graphEdge.deleteMany({}),
    prisma.graphNode.deleteMany({}),
    prisma.graphNode.createMany({
      data: nodes.map(n => ({
        id: n.id,
        type: n.type,
        refId: n.refId,
        label: n.label,
        props: n.props as Prisma.InputJsonValue,
      })),
    }),
    prisma.graphEdge.createMany({
      data: edges.map(e => ({ id: e.id, type: e.type, sourceId: e.source, targetId: e.target })),
    }),
  ])

  return Response.json({
    status: 'ok',
    entities: entities.length,
    documents: documents.length,
    records: records.length,
    nodes: nodes.length,
    edges: edges.length,
  })
}
