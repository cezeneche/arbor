import { projectGraph, nodeId, edgeId, type GraphProjectionInput } from '../project'

// Upgrade 4 — property graph. The projector turns a consistent relational
// snapshot into typed nodes + edges. Pure and store-agnostic: it commits to no
// graph database, so it holds whatever the persistence layer becomes (Postgres
// edge tables, Neo4j, …). Multi-hop questions run over what this produces.

const BASE: GraphProjectionInput = {
  entities: [
    { id: 'sup1', legalName: 'Acme Steel', entityType: 'SUPPLIER', country: 'GB', sector: 'steel' },
    { id: 'buy1', legalName: 'MegaCorp', entityType: 'BUYER', country: 'GB', sector: 'automotive' },
  ],
  documents: [{ id: 'doc1', entityId: 'sup1', documentType: 'CUSTOMS_DECLARATION', fileName: 'c.pdf' }],
  records: [
    { id: 'rec1', entityId: 'sup1', documentId: 'doc1', domain: 'LOGISTICS', fieldName: 'declared_weight' },
    { id: 'rec2', entityId: 'sup1', documentId: null, domain: 'ENERGY', fieldName: 'total_consumption_kwh' },
  ],
  sameAs: [],
  supplies: [{ supplierEntityId: 'sup1', buyerEntityId: 'buy1' }],
}

describe('projectGraph — nodes', () => {
  it('emits one typed node per entity, document, and record', () => {
    const { nodes } = projectGraph(BASE)
    const byId = new Map(nodes.map(n => [n.id, n]))
    expect(byId.get(nodeId('ENTITY', 'sup1'))).toMatchObject({ type: 'ENTITY', refId: 'sup1', label: 'Acme Steel' })
    expect(byId.get(nodeId('DOCUMENT', 'doc1'))).toMatchObject({ type: 'DOCUMENT', refId: 'doc1' })
    expect(byId.get(nodeId('RECORD', 'rec1'))).toMatchObject({ type: 'RECORD', refId: 'rec1' })
    expect(nodes).toHaveLength(5) // 2 entities + 1 document + 2 records
  })

  it('de-duplicates repeated entities into a single node', () => {
    const { nodes } = projectGraph({
      ...BASE,
      entities: [...BASE.entities, BASE.entities[0]],
    })
    expect(nodes.filter(n => n.id === nodeId('ENTITY', 'sup1'))).toHaveLength(1)
  })
})

describe('projectGraph — edges', () => {
  it('links entity→document (SUBMITTED), entity→record (OWNS), document→record (YIELDED)', () => {
    const { edges } = projectGraph(BASE)
    const types = new Map(edges.map(e => [e.id, e]))
    expect(types.get(edgeId('SUBMITTED', nodeId('ENTITY', 'sup1'), nodeId('DOCUMENT', 'doc1')))).toBeDefined()
    expect(types.get(edgeId('OWNS', nodeId('ENTITY', 'sup1'), nodeId('RECORD', 'rec1')))).toBeDefined()
    expect(types.get(edgeId('YIELDED', nodeId('DOCUMENT', 'doc1'), nodeId('RECORD', 'rec1')))).toBeDefined()
  })

  it('emits OWNS but no YIELDED for a record with no source document', () => {
    const { edges } = projectGraph(BASE)
    expect(edges.some(e => e.type === 'OWNS' && e.target === nodeId('RECORD', 'rec2'))).toBe(true)
    expect(edges.some(e => e.type === 'YIELDED' && e.target === nodeId('RECORD', 'rec2'))).toBe(false)
  })

  it('emits a SUPPLIES edge from supplier to buyer, de-duplicated across relationships', () => {
    const { edges } = projectGraph({
      ...BASE,
      supplies: [
        { supplierEntityId: 'sup1', buyerEntityId: 'buy1' },
        { supplierEntityId: 'sup1', buyerEntityId: 'buy1' },
      ],
    })
    const supplies = edges.filter(e => e.type === 'SUPPLIES')
    expect(supplies).toHaveLength(1)
    expect(supplies[0]).toMatchObject({
      source: nodeId('ENTITY', 'sup1'),
      target: nodeId('ENTITY', 'buy1'),
    })
  })

  it('emits a SAME_AS edge from a confirmed entity link', () => {
    const { edges } = projectGraph({
      ...BASE,
      entities: [
        ...BASE.entities,
        { id: 'sup2', legalName: 'ACME STEEL LTD', entityType: 'SUPPLIER', country: 'GB', sector: 'steel' },
      ],
      sameAs: [{ entityAId: 'sup1', entityBId: 'sup2' }],
    })
    expect(
      edges.some(
        e =>
          e.type === 'SAME_AS' &&
          e.source === nodeId('ENTITY', 'sup1') &&
          e.target === nodeId('ENTITY', 'sup2'),
      ),
    ).toBe(true)
  })

  it('skips an edge whose endpoint node is not in the snapshot (consistency guard)', () => {
    const { edges } = projectGraph({
      ...BASE,
      supplies: [{ supplierEntityId: 'sup1', buyerEntityId: 'ghost' }],
    })
    expect(edges.some(e => e.type === 'SUPPLIES')).toBe(false)
  })

  it('is deterministic regardless of input ordering', () => {
    const a = projectGraph(BASE)
    const reversed: GraphProjectionInput = {
      entities: [...BASE.entities].reverse(),
      documents: BASE.documents,
      records: [...BASE.records].reverse(),
      sameAs: [],
      supplies: BASE.supplies,
    }
    const b = projectGraph(reversed)
    expect(b.nodes.map(n => n.id)).toEqual(a.nodes.map(n => n.id))
    expect(b.edges.map(e => e.id)).toEqual(a.edges.map(e => e.id))
  })
})
