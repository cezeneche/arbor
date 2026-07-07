import { summariseCorrections, type ReviewLabel } from '../correction-summary'

// correction-agency reinforcement. Every human review decision is a
// GroundTruthLabel; this counts them so the UI can reflect the user's vigilance
// back to them ("your corrections improve every future extraction"). Pure.

function label(source: ReviewLabel['source'], wasCorrect: boolean): ReviewLabel {
  return { source, wasCorrect }
}

describe('summariseCorrections', () => {
  it('counts reviewed, confirmed, and corrected', () => {
    const s = summariseCorrections([
      label('REVIEW_CONFIRMED', true),
      label('REVIEW_CONFIRMED', true),
      label('REVIEW_CORRECTED', false),
    ])
    expect(s).toEqual({ reviewed: 3, confirmed: 2, corrected: 1 })
  })

  it('is zeroed for an empty history', () => {
    expect(summariseCorrections([])).toEqual({ reviewed: 0, confirmed: 0, corrected: 0 })
  })

  it('classifies by source, not by wasCorrect alone', () => {
    // A corrected label is always a correction regardless of the flag.
    const s = summariseCorrections([label('REVIEW_CORRECTED', false), label('REVIEW_CORRECTED', false)])
    expect(s.corrected).toBe(2)
    expect(s.confirmed).toBe(0)
  })
})
