// Upgrade 4 — property graph, projection layer. Pure: no DB, no network, no
// store dependency.
//
// Arbor's relational store already encodes relationships as foreign keys; this
// turns a consistent snapshot of those rows into an explicit typed graph —
// nodes (entities, documents, records) and edges (who submitted what, which
// document yielded which record, who supplies whom, which entities are the same
// real-world company). Multi-hop questions ("every buyer whose certified
// supplier is a subsidiary of a sanctioned entity") run over this in one
// traversal instead of a pile of SQL joins.
//
// Deliberately store-agnostic: the projection is the same whether it is later
// materialised into Postgres edge tables or a dedicated graph database, so the
// store choice never reaches back into this logic. Runs off the write path — a
// derived view of committed data, never a second source of truth in the Layer 2
// critical section.

export type GraphNodeType = 'ENTITY' | 'DOCUMENT' | 'RECORD'

export type GraphEdgeType =
  | 'SUBMITTED' // Entity → Document
  | 'OWNS' // Entity → Record
  | 'YIELDED' // Document → Record
  | 'SAME_AS' // Entity → Entity (a confirmed resolution link)
  | 'SUPPLIES' // Entity(supplier) → Entity(buyer)

export interface GraphNode {
  /** Namespaced graph id, e.g. "entity:abc". Unique across the graph. */
  id: string
  type: GraphNodeType
  /** The underlying relational row id. */
  refId: string
  /** Human-readable label (legal name / file name / field name). */
  label: string
  props: Record<string, string | number | null>
}

export interface GraphEdge {
  /** Stable, dedup-friendly id derived from type + endpoints. */
  id: string
  type: GraphEdgeType
  /** Source node id. */
  source: string
  /** Target node id. */
  target: string
}

export interface GraphProjectionInput {
  entities: { id: string; legalName: string; entityType: string; country: string; sector: string }[]
  documents: { id: string; entityId: string; documentType: string; fileName: string }[]
  records: { id: string; entityId: string; documentId: string | null; domain: string; fieldName: string }[]
  /** Confirmed "same real-world entity" links (id-sorted a<b). */
  sameAs: { entityAId: string; entityBId: string }[]
  /** Distinct supplier→buyer trade relationships. */
  supplies: { supplierEntityId: string; buyerEntityId: string }[]
}

export interface GraphProjection {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Namespaced node id for a relational row. */
export function nodeId(type: GraphNodeType, refId: string): string {
  return `${type.toLowerCase()}:${refId}`
}

/** Stable edge id — same type + endpoints always collapse to one edge. */
export function edgeId(type: GraphEdgeType, source: string, target: string): string {
  return `${type}:${source}->${target}`
}

export function projectGraph(input: GraphProjectionInput): GraphProjection {
  const nodes = new Map<string, GraphNode>()

  const addNode = (node: GraphNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node)
  }

  for (const e of input.entities) {
    addNode({
      id: nodeId('ENTITY', e.id),
      type: 'ENTITY',
      refId: e.id,
      label: e.legalName,
      props: { entityType: e.entityType, country: e.country, sector: e.sector },
    })
  }
  for (const d of input.documents) {
    addNode({
      id: nodeId('DOCUMENT', d.id),
      type: 'DOCUMENT',
      refId: d.id,
      label: d.fileName,
      props: { documentType: d.documentType },
    })
  }
  for (const r of input.records) {
    addNode({
      id: nodeId('RECORD', r.id),
      type: 'RECORD',
      refId: r.id,
      label: r.fieldName,
      props: { domain: r.domain },
    })
  }

  const edges = new Map<string, GraphEdge>()

  const addEdge = (type: GraphEdgeType, source: string, target: string): void => {
    // Consistency guard: never emit a dangling edge into a node the snapshot
    // does not contain.
    if (!nodes.has(source) || !nodes.has(target)) return
    const id = edgeId(type, source, target)
    if (!edges.has(id)) edges.set(id, { id, type, source, target })
  }

  for (const d of input.documents) {
    addEdge('SUBMITTED', nodeId('ENTITY', d.entityId), nodeId('DOCUMENT', d.id))
  }
  for (const r of input.records) {
    addEdge('OWNS', nodeId('ENTITY', r.entityId), nodeId('RECORD', r.id))
    if (r.documentId) {
      addEdge('YIELDED', nodeId('DOCUMENT', r.documentId), nodeId('RECORD', r.id))
    }
  }
  for (const link of input.sameAs) {
    addEdge('SAME_AS', nodeId('ENTITY', link.entityAId), nodeId('ENTITY', link.entityBId))
  }
  for (const s of input.supplies) {
    addEdge('SUPPLIES', nodeId('ENTITY', s.supplierEntityId), nodeId('ENTITY', s.buyerEntityId))
  }

  // Deterministic output, independent of input ordering.
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id))
  const sortedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id))
  return { nodes: sortedNodes, edges: sortedEdges }
}
