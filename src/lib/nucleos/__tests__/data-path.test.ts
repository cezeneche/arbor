import { DATA_PATHS, describePath, type DataPathId } from '../data-path'

// A goods line with no emissions figure can be filled two ways, and the whole
// point of naming them is that they are NOT interchangeable. One is a
// measurement of the supplier's actual production; the other is a published
// number that stands in for one. A UI that lets a user pick without seeing that
// difference produces declarations nobody can defend.

describe('describePath', () => {
  it('offers exactly the two ways a gap can honestly be filled', () => {
    expect(DATA_PATHS.map(p => p.id).sort()).toEqual(['default', 'supplier'])
  })

  it('records a supplier answer as an actual measurement', () => {
    expect(describePath('supplier').emissionsMethod).toBe('ACTUAL')
  })

  it('never records a published default as an actual measurement', () => {
    // The failure this prevents: a default-derived figure entering a return as
    // though the supplier had reported it.
    expect(describePath('default').emissionsMethod).toBe('DEFAULT')
  })

  it('warns that the default carries a legislated mark-up', () => {
    const d = describePath('default')
    expect(d.markupApplies).toBe(true)
    expect(d.consequence.toLowerCase()).toContain('mark-up')
  })

  it('does not claim a mark-up on a supplier figure', () => {
    expect(describePath('supplier').markupApplies).toBe(false)
  })

  it('says the default is always available, because that is why it exists', () => {
    expect(describePath('default').alwaysAvailable).toBe(true)
    expect(describePath('supplier').alwaysAvailable).toBe(false)
  })

  it('quotes no mark-up percentage of its own', () => {
    // The table lives in Nucleos. A second copy here would drift, and a stale
    // percentage on screen is worse than no percentage.
    for (const p of DATA_PATHS) {
      expect(`${p.consequence} ${p.body}`).not.toMatch(/\d+\s*%/)
    }
  })

  it('speaks of method, never of provenance tier', () => {
    // Two orthogonal axes. Calling a DEFAULT figure "Tier C" would merge them.
    for (const p of DATA_PATHS) {
      expect(`${p.title} ${p.body} ${p.consequence}`).not.toMatch(/tier/i)
    }
  })

  it('falls back to the default path for an unknown id', () => {
    expect(describePath('nonsense' as DataPathId).id).toBe('default')
  })
})
