// Layer 3 — §1. A record type declares one canonical unit. A record stored in
// anything else is invalid, and invalid is a blocking condition, not a display
// problem to be papered over in the label.
//
// This is the rule behind the bug that prompted it: the figure read
// "Total consumption kwh" above a value in MJ. The stored value was right —
// total_consumption_kwh is canonically `mj` and the writer converts on the way
// in — but a record written straight in kWh bypasses that and is invalid.

import { findUnitConflicts, canonicalUnitIndex, type UnitCheckRecord } from '../unit-integrity'

const canonical = canonicalUnitIndex()

const rec = (o: Partial<UnitCheckRecord> = {}): UnitCheckRecord => ({
  id: 'rec_1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  unit: 'mj',
  ...o,
})

describe('canonicalUnitIndex', () => {
  it('knows the canonical unit of a stored field', () => {
    expect(canonical['ENERGY::total_consumption_kwh']).toBe('mj')
  })
})

describe('findUnitConflicts', () => {
  it('passes a record stored in its canonical unit', () => {
    expect(findUnitConflicts([rec({ unit: 'mj' })], canonical)).toEqual([])
  })

  it('fails a record stored outside its type allowed set', () => {
    // The exact defect: written as kWh instead of converted to MJ.
    const [conflict] = findUnitConflicts([rec({ unit: 'kWh' })], canonical)
    expect(conflict.recordId).toBe('rec_1')
    expect(conflict.unit).toBe('kWh')
    expect(conflict.expected).toBe('mj')
  })

  it('ignores case and surrounding space, which are not real differences', () => {
    expect(findUnitConflicts([rec({ unit: ' MJ ' })], canonical)).toEqual([])
  })

  it('holds no opinion on a field with no canonical unit', () => {
    // Categorical and dimensionless fields declare null; anything is allowed.
    const conflicts = findUnitConflicts(
      [rec({ fieldName: 'read_type', unit: 'ACTUAL' })],
      { 'ENERGY::read_type': null },
    )
    expect(conflicts).toEqual([])
  })

  it('holds no opinion on a field absent from the catalogue', () => {
    expect(findUnitConflicts([rec({ fieldName: 'not_catalogued' })], canonical)).toEqual([])
  })

  it('reports every offending record, not just the first', () => {
    const conflicts = findUnitConflicts(
      [rec({ id: 'a', unit: 'kWh' }), rec({ id: 'b', unit: 'therms' }), rec({ id: 'c', unit: 'mj' })],
      canonical,
    )
    expect(conflicts.map(c => c.recordId)).toEqual(['a', 'b'])
  })
})
