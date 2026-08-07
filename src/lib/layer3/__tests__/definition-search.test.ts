// Layer 3 — the "What your figures mean" search. Reading only: it narrows an
// already-loaded list, never queries or transforms a stored value.

import { searchDefinitions, type SearchableDefinition } from '../definition-search'

const rows: SearchableDefinition[] = [
  {
    id: 'd1',
    fieldName: 'total_consumption_kwh',
    label: 'Electricity used',
    domainLabel: 'Energy',
    definition: 'All electricity drawn from the grid at the site over the period.',
    boundary: 'Includes on-site generation exported back to the grid.',
    canonicalUnit: 'MJ',
    counterpartyNames: ['Midlands Steel Ltd'],
  },
  {
    id: 'd2',
    fieldName: 'quantity_produced',
    label: 'Output produced',
    domainLabel: 'Production',
    definition: 'Finished goods leaving the line, measured at the weighbridge.',
    boundary: 'Excludes scrap and rework.',
    canonicalUnit: 'kg',
    counterpartyNames: [],
  },
  {
    id: 'd3',
    fieldName: 'shipment_weight',
    label: 'Weight shipped',
    domainLabel: 'Logistics',
    definition: 'Gross weight of goods despatched to the customer.',
    boundary: 'Includes packaging.',
    canonicalUnit: 'kg',
    counterpartyNames: ['Northern Foods plc'],
  },
]

describe('searchDefinitions', () => {
  it('returns every row when the query is empty', () => {
    // An empty search box must not hide anything — the page still reads as a list.
    expect(searchDefinitions(rows, '').map(r => r.id)).toEqual(['d1', 'd2', 'd3'])
    expect(searchDefinitions(rows, '   ').map(r => r.id)).toEqual(['d1', 'd2', 'd3'])
  })

  it('matches the plain English label regardless of case', () => {
    expect(searchDefinitions(rows, 'ELECTRICITY').map(r => r.id)).toEqual(['d1'])
  })

  it('matches wording inside the definition text', () => {
    // The SME searches for the words they remember, not the field name.
    expect(searchDefinitions(rows, 'weighbridge').map(r => r.id)).toEqual(['d2'])
  })

  it('matches wording inside the boundary statement', () => {
    expect(searchDefinitions(rows, 'packaging').map(r => r.id)).toEqual(['d3'])
  })

  it('matches the technical field name, with or without underscores', () => {
    expect(searchDefinitions(rows, 'total_consumption_kwh').map(r => r.id)).toEqual(['d1'])
    expect(searchDefinitions(rows, 'quantity produced').map(r => r.id)).toEqual(['d2'])
  })

  it('matches the domain label', () => {
    expect(searchDefinitions(rows, 'logistics').map(r => r.id)).toEqual(['d3'])
  })

  it('matches the name of a company the wording is shared with', () => {
    expect(searchDefinitions(rows, 'northern foods').map(r => r.id)).toEqual(['d3'])
  })

  it('requires every whitespace-separated term to match', () => {
    // "energy grid" should find the energy row; "energy scrap" should find nothing.
    expect(searchDefinitions(rows, 'energy grid').map(r => r.id)).toEqual(['d1'])
    expect(searchDefinitions(rows, 'energy scrap')).toEqual([])
  })

  it('returns nothing when no row matches', () => {
    expect(searchDefinitions(rows, 'zzz-not-a-field')).toEqual([])
  })

  it('preserves the incoming order of matches', () => {
    expect(searchDefinitions(rows, 'kg').map(r => r.id)).toEqual(['d2', 'd3'])
  })
})
