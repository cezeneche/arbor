import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { nodeId, type GraphEdgeType } from '@/lib/graph/project'
import { neighbourhood, type TraversableEdge } from '@/lib/graph/traverse'

// the multi-hop query surface (ADMIN). Given a start entity, returns
// every node reachable within N hops of the property graph — the question a
// relational join can't answer cleanly. Read-only over the derived graph.
//
// At current scale the whole edge set is loaded and traversed in memory; a
// recursive CTE is the drop-in escalation when the graph outgrows that.
const MAX_DEPTH = 5
const EDGE_CAP = 100000

const EDGE_TYPES: GraphEdgeType[] = ['SUBMITTED', 'OWNS', 'YIELDED', 'SAME_AS', 'SUPPLIES']

export async function GET(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return err('entityId is required', 'VALIDATION_ERROR', 400)

  const depth = Math.min(Math.max(Number.parseInt(sp.get('depth') ?? '2', 10) || 2, 1), MAX_DEPTH)
  const directed = sp.get('directed') === 'true'
  const edgeTypes = sp
    .get('edgeTypes')
    ?.split(',')
    .map(t => t.trim())
    .filter((t): t is GraphEdgeType => (EDGE_TYPES as string[]).includes(t))

  const start = nodeId('ENTITY', entityId)

  const edgeRows = await prisma.graphEdge.findMany({
    select: { type: true, sourceId: true, targetId: true },
    take: EDGE_CAP,
  })
  const edges: TraversableEdge[] = edgeRows.map(e => ({
    type: e.type,
    source: e.sourceId,
    target: e.targetId,
  }))

  const reached = neighbourhood(edges, start, {
    depth,
    directed,
    ...(edgeTypes && edgeTypes.length > 0 ? { edgeTypes } : {}),
  })

  // Hydrate the reached node ids with their labels/types.
  const nodeMap = new Map(
    (
      await prisma.graphNode.findMany({
        where: { id: { in: reached.map(r => r.nodeId) } },
        select: { id: true, type: true, label: true },
      })
    ).map(n => [n.id, n]),
  )

  return ok({
    start,
    depth,
    directed,
    count: reached.length,
    reached: reached.map(r => ({
      id: r.nodeId,
      distance: r.distance,
      type: nodeMap.get(r.nodeId)?.type ?? null,
      label: nodeMap.get(r.nodeId)?.label ?? null,
    })),
  })
}
