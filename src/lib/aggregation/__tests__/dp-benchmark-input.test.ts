import { buildCanonicalMap, canonicalId } from '../entity-canonical'
import { buildDpGroups, type BenchmarkRow } from '../dp-benchmark-input'

// canonical aggregation units (via entity resolution) + DP group building.

describe('buildCanonicalMap', () => {
  it('collapses a chain of links to the smallest id', () => {
    const map = buildCanonicalMap([
      { entityAId: 'b', entityBId: 'c' },
      { entityAId: 'a', entityBId: 'b' },
    ])
    expect(canonicalId(map, 'a')).toBe('a')
    expect(canonicalId(map, 'b')).toBe('a')
    expect(canonicalId(map, 'c')).toBe('a')
  })

  it('keeps separate components separate', () => {
    const map = buildCanonicalMap([{ entityAId: 'd', entityBId: 'e' }])
    expect(canonicalId(map, 'd')).toBe('d')
    expect(canonicalId(map, 'e')).toBe('d')
  })

  it('maps an unlinked entity to itself', () => {
    const map = buildCanonicalMap([])
    expect(canonicalId(map, 'solo')).toBe('solo')
  })
})

function row(entityId: string, value: number, fieldName = 'embedded_emissions_per_tonne'): BenchmarkRow {
  return { entityId, sector: 'steel', domain: 'EMISSIONS', fieldName, value, unit: 'tCO2e/t' }
}

describe('buildDpGroups', () => {
  it('produces one value per entity in a group', () => {
    const [g] = buildDpGroups([row('e1', 2.0), row('e2', 3.0)], new Map())
    expect(g.values.sort()).toEqual([2.0, 3.0])
    expect(g.low).toBe(0)
    expect(g.high).toBe(30)
  })

  it('collapses SAME_AS-linked entities into one contributor', () => {
    // e1 and e2 are the same real-world entity → one averaged value, not two.
    const map = buildCanonicalMap([{ entityAId: 'e1', entityBId: 'e2' }])
    const [g] = buildDpGroups([row('e1', 2.0), row('e2', 4.0)], map)
    expect(g.values).toEqual([3.0]) // mean of 2 and 4, counted once
  })

  it('excludes fields without public bounds', () => {
    const groups = buildDpGroups([row('e1', 100, 'total_value')], new Map())
    expect(groups).toEqual([])
  })
})
