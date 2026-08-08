// The review grid, decided before it is rendered.
//
// The screen used to draw three separate grids — compulsory, conditional,
// optional — so a document with 9 + 1 + 2 fields left a hole beside the ninth
// compulsory field and another beside the only conditional one. Twelve fields
// that should fill six complete rows filled eight ragged ones.
//
// So the order is decided here, over every field at once, and the requirement
// level travels on the card instead of in a heading. Nothing is hidden and
// nothing is reordered away from what matters first: compulsory fields still
// come before conditional before optional, and within each group the
// information-gain ranking still leads with the field worth asking about.

import { layoutReviewFields, type LayoutField } from '../review-layout'

const field = (over: Partial<LayoutField> & { fieldName: string }): LayoutField => ({
  admissibility: 'COMPULSORY',
  confidence: 0.99,
  flagged: false,
  hasValue: true,
  ...over,
})

const names = (fs: LayoutField[]) => layoutReviewFields(fs).map(f => f.fieldName)

describe('layoutReviewFields', () => {
  it('lays out nothing when there is nothing to review', () => {
    expect(layoutReviewFields([])).toEqual([])
  })

  it('keeps every field — the grid hides nothing', () => {
    const fields = Array.from({ length: 12 }, (_, i) => field({ fieldName: `f${i}` }))
    expect(layoutReviewFields(fields)).toHaveLength(12)
  })

  it('puts compulsory before conditional before optional', () => {
    expect(names([
      field({ fieldName: 'customs_procedure', admissibility: 'OPTIONAL' }),
      field({ fieldName: 'currency', admissibility: 'CONDITIONAL' }),
      field({ fieldName: 'commodity_code', admissibility: 'COMPULSORY' }),
    ])).toEqual(['commodity_code', 'currency', 'customs_procedure'])
  })

  it('leads each group with the field worth asking about', () => {
    // An uncertain field carries close to a full bit; a near-certain one carries
    // almost none. The uncertain one is asked first even though it sorts later.
    expect(names([
      field({ fieldName: 'z_certain', confidence: 0.99 }),
      field({ fieldName: 'a_uncertain', confidence: 0.5 }),
    ])).toEqual(['a_uncertain', 'z_certain'])
  })

  it('does not let information gain jump a field out of its group', () => {
    // An optional field the model is 50/50 on outranks a confident compulsory
    // one on gain alone. It still comes second: the grouping is the contract.
    expect(names([
      field({ fieldName: 'declared_value', admissibility: 'OPTIONAL', confidence: 0.5 }),
      field({ fieldName: 'commodity_code', admissibility: 'COMPULSORY', confidence: 0.99 }),
    ])).toEqual(['commodity_code', 'declared_value'])
  })

  it('carries the requirement level onto each card', () => {
    // It used to live in a section heading. Without it on the card, a two-column
    // run of twelve fields says nothing about which ones are required.
    const [first] = layoutReviewFields([field({ fieldName: 'currency', admissibility: 'CONDITIONAL' })])
    expect(first.admissibility).toBe('CONDITIONAL')
  })

  it('fills complete rows when the count is even', () => {
    // Twelve fields, two columns, six rows, no holes. Nothing needs to stretch.
    const laid = layoutReviewFields(Array.from({ length: 12 }, (_, i) => field({ fieldName: `f${i}` })))
    expect(laid.filter(f => f.spansRow)).toHaveLength(0)
  })

  it('stretches the last card when the count is odd, so no row is left short', () => {
    const laid = layoutReviewFields(Array.from({ length: 11 }, (_, i) => field({ fieldName: `f${i}` })))
    expect(laid.filter(f => f.spansRow)).toHaveLength(1)
    expect(laid[laid.length - 1].spansRow).toBe(true)
  })

  it('stretches a lone field rather than leaving half a row empty', () => {
    expect(layoutReviewFields([field({ fieldName: 'currency' })])[0].spansRow).toBe(true)
  })

  it('is deterministic — the same fields lay out the same way twice', () => {
    const fields = [
      field({ fieldName: 'b', confidence: 0.9 }),
      field({ fieldName: 'a', confidence: 0.9 }),
      field({ fieldName: 'c', admissibility: 'OPTIONAL' }),
    ]
    expect(names(fields)).toEqual(names(fields))
  })
})
