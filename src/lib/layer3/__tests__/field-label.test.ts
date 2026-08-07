// Layer 3 — what a stored field is called when a person reads it.
//
// The tables showed the database identifier with its underscores stripped:
// "total consumption kwh" above a value of 172.8 mj. The name is a legacy
// identifier that embeds a unit the record is not stored in, so it read as a
// contradiction. The catalogue already carries a plain English label, a
// definition and a boundary for every field; this is the one place that
// resolves them.

import { fieldLabel, fieldMeaning } from '../field-label'

describe('fieldLabel', () => {
  it('uses the catalogue label rather than the identifier', () => {
    expect(fieldLabel('total_consumption_kwh', 'ENERGY')).toBe('Energy used')
    expect(fieldLabel('declared_weight', 'LOGISTICS')).toBe('Weight declared to customs')
  })

  it('never carries a unit in the name, so it cannot contradict the value', () => {
    // The identifier says kwh; the record is stored in mj. The label says neither.
    expect(fieldLabel('total_consumption_kwh', 'ENERGY')).not.toMatch(/kwh|mj/i)
  })

  it('resolves without a domain when the field name is unambiguous', () => {
    expect(fieldLabel('declared_weight')).toBe('Weight declared to customs')
  })

  it('still resolves when the record domain disagrees with the catalogue', () => {
    // declared_weight is stored under Logistics but catalogued under Compliance,
    // because the customs declaration behind it is filed as one and read as the
    // other. Falling back to the raw identifier there helps nobody.
    expect(fieldLabel('declared_weight', 'LOGISTICS')).toBe('Weight declared to customs')
  })

  it('falls back to the readable identifier for a field not in the catalogue', () => {
    expect(fieldLabel('some_custom_field', 'ENERGY')).toBe('Some custom field')
  })

  it('capitalises the fallback rather than showing a bare identifier', () => {
    expect(fieldLabel('another_field')).toBe('Another field')
  })
})

describe('fieldMeaning', () => {
  it('returns the definition and boundary for the tooltip', () => {
    const meaning = fieldMeaning('total_consumption_kwh', 'ENERGY')
    expect(meaning).toContain('drew from the supply network')
    expect(meaning).toContain('Excludes')
  })

  it('returns null when the catalogue has nothing to say', () => {
    expect(fieldMeaning('some_custom_field', 'ENERGY')).toBeNull()
  })
})
