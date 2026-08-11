import { selectReviewableFields } from '../reviewable-fields'

// A real customs declaration reached REVIEW_REQUIRED with six extracted fields
// and never appeared in the review queue. The queue kept only fields in a fixed
// numeric-field set, and when none matched it skipped the document entirely —
// so the document was simultaneously "awaiting review" and unreachable, and the
// screen said there was nothing to review.

const f = (fieldName: string, rawValue: string | null, flagged = false) => ({
  fieldName,
  rawValue,
  rawUnit: null,
  flagged,
  flagReason: null,
  sourceText: '',
  confidenceScore: 1,
})

describe('selectReviewableFields', () => {
  it('prefers the known numeric fields when there are any', () => {
    const picked = selectReviewableFields([f('total_consumption_kwh', '120'), f('supplier_name', 'Acme')])
    expect(picked.map(p => p.fieldName)).toEqual(['total_consumption_kwh'])
  })

  it('falls back to whatever the document has when no numeric field matches', () => {
    // This is the customs declaration case. Its fields are named
    // lines[0].net_mass_kg and friends, which no fixed set can enumerate.
    const picked = selectReviewableFields([f('lines[0].cn_code', '72071111'), f('lines[0].net_mass_kg', '172')])
    expect(picked).toHaveLength(2)
  })

  it('never returns empty for a document that has fields', () => {
    // Returning empty is what made the document vanish: the caller skipped it.
    expect(selectReviewableFields([f('entry_reference', 'ABC')]).length).toBeGreaterThan(0)
  })

  it('keeps a flagged field that has no value, because that is the finding', () => {
    // "This compulsory field was not found" is the single most important thing
    // a reviewer can be told, and it has no value by definition.
    const picked = selectReviewableFields([f('importer_eori', null, true)])
    expect(picked.map(p => p.fieldName)).toContain('importer_eori')
  })

  it('drops an unflagged field with no value, which is merely absent', () => {
    const picked = selectReviewableFields([f('a', '1'), f('unused', null, false)])
    expect(picked.map(p => p.fieldName)).not.toContain('unused')
  })

  it('returns empty only when the document genuinely has no fields', () => {
    expect(selectReviewableFields([])).toEqual([])
  })

  it('does not let the fallback pull in noise alongside real numeric fields', () => {
    // When numeric fields exist the queue keeps its tight, fast-confirm shape.
    const picked = selectReviewableFields([
      f('total_consumption_kwh', '120'),
      f('meter_serial', 'X99'),
      f('address', '1 High St'),
    ])
    expect(picked).toHaveLength(1)
  })
})
