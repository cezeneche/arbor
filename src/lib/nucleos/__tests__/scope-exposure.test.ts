import { scopeExposure } from '../scope-exposure'

// Tonnes are what turn "yes, in scope" into something an importer can act on.
// The line this must not cross is inventing a pound figure: that needs an
// HMRC-published rate, and Nucleos already refuses to derive a liability from a
// placeholder one.

describe('scopeExposure', () => {
  it('multiplies tonnage by the published default', () => {
    expect(scopeExposure({ tonnes: 100, defaultSeeTco2ePerT: 2.21 })!.embeddedTco2e).toBe(221)
  })

  it('rounds to two decimals rather than showing float noise', () => {
    expect(scopeExposure({ tonnes: 3, defaultSeeTco2ePerT: 2.21 })!.embeddedTco2e).toBe(6.63)
  })

  it('returns nothing without a tonnage, rather than assuming one', () => {
    expect(scopeExposure({ tonnes: 0, defaultSeeTco2ePerT: 2.21 })).toBeNull()
  })

  it('returns nothing when no default exists for the code', () => {
    expect(scopeExposure({ tonnes: 100, defaultSeeTco2ePerT: 0 })).toBeNull()
  })

  it('never produces a currency figure', () => {
    // A pound total needs a published HMRC rate. Deriving one here would route
    // around the refusal that exists precisely to stop that.
    const e = scopeExposure({ tonnes: 100, defaultSeeTco2ePerT: 2.21 })!
    expect(`${e.basis} ${e.qualification}`).not.toMatch(/[£$€]/)
  })

  it('cites the regulation the default comes from', () => {
    expect(scopeExposure({ tonnes: 1, defaultSeeTco2ePerT: 2.21 })!.basis).toContain('Annex VI')
  })

  it('says the real figure is higher, because the mark-up is not in it', () => {
    const e = scopeExposure({ tonnes: 1, defaultSeeTco2ePerT: 2.21 })!
    expect(e.qualification).toContain('mark-up')
  })
})
