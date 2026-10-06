import { scopeThresholdNotes } from '../scope-threshold'

// A covered commodity code is not the whole answer: a small importer may be
// exempt. The EU exempts importers of 50 tonnes or less a year (EU 2023/956
// Art. 2a, from 1 January 2026; the EUR 150 consignment rule it replaced is
// gone). The UK applies CBAM from £50,000 of CBAM goods in 12 months (GOV.UK,
// "Work out the date you'll need to register"). Neither can be judged from one
// commodity code, so the check says "covered" and states the threshold for the
// regime the organisation files under, rather than guessing an exemption.

const MASS = 'de_minimis:annual_mass_threshold:50t — an importer is exempt only if ...'
const NONE = 'de_minimis:not_available:hydrogen — the 50-tonne annual exemption does not cover hydrogen'
const COVERED = 'annex_i:covered:72081000:sector=iron_steel — CN code is covered'

describe('scopeThresholdNotes', () => {
  it('states the EU 50-tonne exemption to an EU importer of a covered good', () => {
    const notes = scopeThresholdNotes({ reasons: [COVERED, MASS], jurisdiction: 'EU' })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/50 tonnes or less/)
    expect(notes[0]).toMatch(/calendar year/)
    expect(notes[0]).not.toMatch(/£/)
  })

  it('tells an EU importer that hydrogen has no exemption', () => {
    const notes = scopeThresholdNotes({ reasons: [COVERED, NONE], jurisdiction: 'EU' })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/does not cover hydrogen or electricity/)
  })

  it('states the UK £50,000 threshold to a UK importer, and not the EU rule', () => {
    const notes = scopeThresholdNotes({ reasons: [COVERED, MASS], jurisdiction: 'UK' })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/£50,000/)
    expect(notes[0]).toMatch(/12 months/)
    expect(notes[0]).not.toMatch(/tonnes/)
  })

  it('gives both, labelled, to an importer filing under both regimes', () => {
    const notes = scopeThresholdNotes({ reasons: [COVERED, MASS], jurisdiction: 'BOTH' })
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatch(/^UK: /)
    expect(notes[1]).toMatch(/^EU: /)
  })

  it('says nothing when the code is not covered', () => {
    expect(
      scopeThresholdNotes({ reasons: ['annex_i:not_covered:84713000 — not listed'], jurisdiction: 'BOTH' }),
    ).toEqual([])
  })

  it('never says the goods are exempt', () => {
    for (const jurisdiction of ['UK', 'EU', 'BOTH'] as const) {
      for (const note of scopeThresholdNotes({ reasons: [COVERED, MASS], jurisdiction })) {
        expect(note).not.toMatch(/you are exempt\b(?! only)/i)
        expect(note).not.toMatch(/out of scope/i)
      }
    }
  })
})
