import {
  grantedRecordsWhere,
  resolveSupplierScope,
  supplierGapsWithinGrants,
  describeScope,
  type SupplierGrant,
} from '../nl-query-scope'
import { anyGrantCoversRecord } from '../grant-scope'
import type { DataDomain } from '@prisma/client'

const d = (iso: string) => new Date(iso)

const grants: SupplierGrant[] = [
  // Energy only, 2026 only.
  { grantorEntityId: 'sup-a', domain: 'ENERGY', periodStart: d('2026-01-01'), periodEnd: d('2026-12-31'), fieldNames: null },
  // Everything, one field.
  { grantorEntityId: 'sup-b', domain: null, periodStart: null, periodEnd: null, fieldNames: ['declared_weight'] },
]

type Rec = { entityId: string; domain: DataDomain; fieldName: string; periodStart: Date; periodEnd: Date }

/** Evaluates exactly the where-clause shapes grantedRecordsWhere produces. */
function matches(where: ReturnType<typeof grantedRecordsWhere>, r: Rec): boolean {
  if (!where) return false
  return where.OR.some(c => {
    if (c.entityId !== r.entityId) return false
    if (c.domain && c.domain !== r.domain) return false
    if (c.periodEnd && !(r.periodEnd >= c.periodEnd.gte)) return false
    if (c.periodStart && !(r.periodStart <= c.periodStart.lte)) return false
    if (c.fieldName && !c.fieldName.in.includes(r.fieldName)) return false
    return true
  })
}

// Supplier records were fetched 201 at a time and only then filtered against
// the grants, so a page mostly outside the grants hid in-scope records behind
// it — and reported the answer as complete. The grant scope now goes into the
// database query itself.
describe('grantedRecordsWhere', () => {
  const records: Rec[] = [
    { entityId: 'sup-a', domain: 'ENERGY', fieldName: 'total_consumption_kwh', periodStart: d('2026-02-01'), periodEnd: d('2026-02-28') },
    { entityId: 'sup-a', domain: 'ENERGY', fieldName: 'total_consumption_kwh', periodStart: d('2025-02-01'), periodEnd: d('2025-02-28') },
    { entityId: 'sup-a', domain: 'MATERIALS', fieldName: 'quantity', periodStart: d('2026-02-01'), periodEnd: d('2026-02-28') },
    { entityId: 'sup-b', domain: 'LOGISTICS', fieldName: 'declared_weight', periodStart: d('2024-01-01'), periodEnd: d('2024-01-01') },
    { entityId: 'sup-b', domain: 'LOGISTICS', fieldName: 'shipment_weight', periodStart: d('2024-01-01'), periodEnd: d('2024-01-01') },
    { entityId: 'sup-c', domain: 'ENERGY', fieldName: 'total_consumption_kwh', periodStart: d('2026-02-01'), periodEnd: d('2026-02-28') },
  ]

  it('selects exactly the records the grants cover', () => {
    const where = grantedRecordsWhere(grants)
    for (const r of records) {
      const own = grants.filter(g => g.grantorEntityId === r.entityId)
      expect([r.entityId, r.fieldName, matches(where, r)]).toEqual([
        r.entityId,
        r.fieldName,
        anyGrantCoversRecord(own, r),
      ])
    }
  })

  it('is null when there is nothing granted, so nothing is read', () => {
    expect(grantedRecordsWhere([])).toBeNull()
  })
})

describe('resolveSupplierScope', () => {
  const suppliers = [
    { id: 'sup-a', name: 'Acme Steel Ltd' },
    { id: 'sup-b', name: 'Northern Freight Limited' },
  ]

  it('is every supplier when none is named', () => {
    expect(resolveSupplierScope({}, suppliers)).toEqual({ kind: 'all' })
  })

  it('takes an authorised id the parser chose', () => {
    expect(resolveSupplierScope({ supplierEntityId: 'sup-b' }, suppliers)).toEqual({
      kind: 'one', id: 'sup-b', name: 'Northern Freight Limited',
    })
  })

  it('matches a name however the company is spelt', () => {
    expect(resolveSupplierScope({ supplierName: 'ACME STEEL' }, suppliers)).toMatchObject({ kind: 'one', id: 'sup-a' })
    expect(resolveSupplierScope({ supplierName: 'northern freight ltd' }, suppliers)).toMatchObject({ kind: 'one', id: 'sup-b' })
  })

  // An unmatched name used to fall back to every authorised supplier, so
  // "show me Brighton Metals' figures" answered about everyone else.
  it('says a named supplier was not found instead of widening to all', () => {
    expect(resolveSupplierScope({ supplierName: 'Brighton Metals' }, suppliers)).toEqual({
      kind: 'unmatched', name: 'Brighton Metals',
    })
  })

  it('does not trust an id outside the authorised list', () => {
    expect(resolveSupplierScope({ supplierEntityId: 'sup-z', supplierName: 'Zed Ltd' }, suppliers)).toEqual({
      kind: 'unmatched', name: 'Zed Ltd',
    })
  })

  it('refuses to guess between two suppliers a name could mean', () => {
    const two = [...suppliers, { id: 'sup-c', name: 'Acme Steel Wire Ltd' }]
    expect(resolveSupplierScope({ supplierName: 'Acme' }, two)).toEqual({ kind: 'unmatched', name: 'Acme' })
  })
})

// A gap answer is a statement about a supplier's data. It was computed over
// every record the supplier holds, so a buyer granted only energy learnt which
// other areas the supplier had records in. It now speaks only within the grant.
describe('supplierGapsWithinGrants', () => {
  const suppliers = [
    { id: 'sup-a', name: 'Acme Steel Ltd' },
    { id: 'sup-b', name: 'Northern Freight Limited' },
  ]

  it('reports only areas the grant covers', () => {
    const gaps = supplierGapsWithinGrants({
      suppliers,
      grants,
      covered: new Map([['sup-b', new Set<string>(['LOGISTICS'])]]),
      targetDomains: ['ENERGY', 'MATERIALS', 'LOGISTICS'],
    })
    expect(gaps).toEqual([
      { supplierEntityId: 'sup-a', supplierName: 'Acme Steel Ltd', missingDomains: ['ENERGY'] },
      { supplierEntityId: 'sup-b', supplierName: 'Northern Freight Limited', missingDomains: ['ENERGY', 'MATERIALS'] },
    ])
  })

  it('says nothing about a supplier whose grant covers none of the areas asked about', () => {
    const gaps = supplierGapsWithinGrants({
      suppliers: [suppliers[0]],
      grants,
      covered: new Map(),
      targetDomains: ['MATERIALS'],
    })
    expect(gaps).toEqual([])
  })
})

// The line above an answer said what the model thought it searched for. For a
// history question it named a period the search had ignored. It now describes
// the filters that actually ran.
describe('describeScope', () => {
  it('names the filters that ran, in plain words', () => {
    expect(
      describeScope({
        queryType: 'entity',
        domain: 'ENERGY',
        fieldName: 'total_consumption_kwh',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        trustTier: 'A',
        supplier: { kind: 'all' },
      }),
    ).toBe('Your records · Energy · Energy used · 1 Jan 2026 to 31 Mar 2026 · Verified only')
  })

  it('names the supplier searched', () => {
    expect(
      describeScope({ queryType: 'supply_chain', supplier: { kind: 'one', id: 'sup-a', name: 'Acme Steel Ltd' } }),
    ).toBe('Acme Steel Ltd · all areas · any period · any status')
  })

  it('says when every shared supplier was searched', () => {
    expect(describeScope({ queryType: 'supply_chain', supplier: { kind: 'all' } })).toBe(
      'Records your suppliers have shared with you · all areas · any period · any status',
    )
  })

  it('describes a gap check as one', () => {
    expect(describeScope({ queryType: 'gap', domain: 'ENERGY', supplier: { kind: 'all' } })).toBe(
      'Areas with no records, for you and your suppliers · Energy · any period',
    )
  })
})
