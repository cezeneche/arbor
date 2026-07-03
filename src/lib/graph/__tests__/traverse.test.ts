import { neighbourhood, type TraversableEdge } from '../traverse'

// Upgrade 4 — multi-hop traversal. This is the capability SQL joins can't express
// cleanly: reach everything connected to a start node within N hops, optionally
// restricted to certain edge types. Pure BFS over the persisted edges (the store
// is the source of truth; a recursive CTE is the scale escalation).

// sup1 —SUPPLIES→ buy1 —SUPPLIES→ buy2 ; sup1 —SAME_AS→ sup2
const EDGES: TraversableEdge[] = [
  { type: 'SUPPLIES', source: 'entity:sup1', target: 'entity:buy1' },
  { type: 'SUPPLIES', source: 'entity:buy1', target: 'entity:buy2' },
  { type: 'SAME_AS', source: 'entity:sup1', target: 'entity:sup2' },
]

describe('neighbourhood', () => {
  it('returns direct neighbours at depth 1, undirected by default', () => {
    const reached = neighbourhood(EDGES, 'entity:buy1', { depth: 1 })
    const ids = reached.map(r => r.nodeId).sort()
    expect(ids).toEqual(['entity:buy2', 'entity:sup1'])
  })

  it('reaches a 2-hop node only at depth ≥ 2', () => {
    expect(neighbourhood(EDGES, 'entity:sup2', { depth: 1 }).map(r => r.nodeId)).toEqual(['entity:sup1'])
    const d2 = neighbourhood(EDGES, 'entity:sup2', { depth: 2 }).map(r => r.nodeId).sort()
    expect(d2).toEqual(['entity:buy1', 'entity:sup1'])
  })

  it('records the shortest distance to each reached node', () => {
    const reached = neighbourhood(EDGES, 'entity:sup2', { depth: 3 })
    const dist = new Map(reached.map(r => [r.nodeId, r.distance]))
    expect(dist.get('entity:sup1')).toBe(1)
    expect(dist.get('entity:buy1')).toBe(2)
    expect(dist.get('entity:buy2')).toBe(3)
  })

  it('never includes the start node itself', () => {
    const reached = neighbourhood(EDGES, 'entity:sup1', { depth: 3 })
    expect(reached.some(r => r.nodeId === 'entity:sup1')).toBe(false)
  })

  it('restricts traversal to the requested edge types', () => {
    const reached = neighbourhood(EDGES, 'entity:sup1', { depth: 3, edgeTypes: ['SAME_AS'] })
    expect(reached.map(r => r.nodeId)).toEqual(['entity:sup2'])
  })

  it('follows only source→target when directed', () => {
    // From buy1, directed, only reaches buy2 (not back to sup1).
    const reached = neighbourhood(EDGES, 'entity:buy1', { depth: 3, directed: true })
    expect(reached.map(r => r.nodeId)).toEqual(['entity:buy2'])
  })

  it('is cycle-safe', () => {
    const cyclic: TraversableEdge[] = [
      { type: 'SUPPLIES', source: 'a', target: 'b' },
      { type: 'SUPPLIES', source: 'b', target: 'a' },
    ]
    const reached = neighbourhood(cyclic, 'a', { depth: 10 })
    expect(reached.map(r => r.nodeId)).toEqual(['b'])
  })

  it('returns nothing for an isolated or unknown start node', () => {
    expect(neighbourhood(EDGES, 'entity:nobody', { depth: 5 })).toEqual([])
  })
})
