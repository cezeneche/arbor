// property graph, traversal. Pure: no DB, no network.
//
// Breadth-first neighbourhood over the persisted edges: everything reachable
// from a start node within N hops. This is the multi-hop capability the graph
// exists for — a relational join can't express "reachable within N steps" without
// knowing N in advance. Undirected by default (identity/supply relationships are
// naturally symmetric to explore); directed when the direction is the question.
//
// At current corpus size the route loads the edge set and runs this in-memory —
// the honest "brute-force now" choice. The store is still the source of truth; a
// recursive CTE is the drop-in escalation when the graph outgrows memory.

import type { GraphEdgeType } from './project'

export interface TraversableEdge {
  type: GraphEdgeType
  source: string
  target: string
}

export interface NeighbourhoodOptions {
  /** Maximum number of hops from the start node. */
  depth: number
  /** Restrict traversal to these edge types (default: all). */
  edgeTypes?: GraphEdgeType[]
  /** Follow source→target only (default false: traverse both directions). */
  directed?: boolean
}

export interface ReachedNode {
  nodeId: string
  /** Shortest number of hops from the start node. */
  distance: number
}

export function neighbourhood(
  edges: TraversableEdge[],
  startId: string,
  opts: NeighbourhoodOptions,
): ReachedNode[] {
  const allowed = opts.edgeTypes ? new Set<GraphEdgeType>(opts.edgeTypes) : null
  const directed = opts.directed ?? false

  // Adjacency: node → neighbours reachable in one hop under the type/direction rules.
  const adjacency = new Map<string, Set<string>>()
  const link = (from: string, to: string): void => {
    const set = adjacency.get(from) ?? new Set<string>()
    set.add(to)
    adjacency.set(from, set)
  }
  for (const e of edges) {
    if (allowed && !allowed.has(e.type)) continue
    link(e.source, e.target)
    if (!directed) link(e.target, e.source)
  }

  // BFS outward, recording the shortest distance and never revisiting.
  const distance = new Map<string, number>([[startId, 0]])
  let frontier = [startId]
  for (let d = 1; d <= opts.depth && frontier.length > 0; d++) {
    const next: string[] = []
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (distance.has(neighbour)) continue
        distance.set(neighbour, d)
        next.push(neighbour)
      }
    }
    frontier = next
  }

  return [...distance.entries()]
    .filter(([id]) => id !== startId)
    .map(([nodeId, dist]) => ({ nodeId, distance: dist }))
    .sort((a, b) => (a.distance === b.distance ? a.nodeId.localeCompare(b.nodeId) : a.distance - b.distance))
}
