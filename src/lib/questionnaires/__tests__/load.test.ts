import { toPrefillRecords, type StoredRecordForPrefill } from '../load'
import type { QuestionnaireTemplate } from '../types'

const template: QuestionnaireTemplate = {
  id: 'test',
  name: 'Test',
  framework: 'Test',
  description: '',
  status: 'available',
  questions: [
    { id: 'elec', text: '', mode: 'assemble', domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'kwh' },
    { id: 'emis', text: '', mode: 'direct', domain: 'EMISSIONS', fieldName: 'total_co2e', unit: 'tonnes_co2e' },
    { id: 'coll', text: '', mode: 'collection', domain: 'ENERGY', fieldName: 'quantity' }, // no unit
  ],
}

const base: StoredRecordForPrefill = {
  id: 'r1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 3.6, // 3.6 MJ === 1 kWh
  unit: 'mj',
  trustTier: 'A',
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-03-31'),
}

describe('toPrefillRecords', () => {
  it('converts a stored SI energy record (mj) into the question unit (kwh)', () => {
    const [out] = toPrefillRecords(template, [base])
    expect(out.unit).toBe('kwh')
    expect(out.value).toBeCloseTo(1, 6)
  })

  it('converts emissions kg_co2e into tonnes_co2e', () => {
    const out = toPrefillRecords(template, [
      { ...base, id: 'e1', domain: 'EMISSIONS', fieldName: 'total_co2e', value: 2000, unit: 'kg_co2e' },
    ])[0]
    expect(out.unit).toBe('tonnes_co2e')
    expect(out.value).toBeCloseTo(2, 6)
  })

  it('passes a record through unchanged when no question declares a target unit', () => {
    const out = toPrefillRecords(template, [
      { ...base, id: 'c1', fieldName: 'quantity', value: 50, unit: 'mj' },
    ])[0]
    expect(out.unit).toBe('mj')
    expect(out.value).toBe(50)
  })

  it('leaves a record unchanged when stored unit already equals the target', () => {
    const out = toPrefillRecords(template, [{ ...base, value: 500, unit: 'kwh' }])[0]
    expect(out.unit).toBe('kwh')
    expect(out.value).toBe(500)
  })

  it('does not crash on a dimensionally incompatible stored unit', () => {
    const out = toPrefillRecords(template, [{ ...base, value: 10, unit: 'kg' }])[0]
    // kg cannot convert to kwh — pass through untouched.
    expect(out.unit).toBe('kg')
    expect(out.value).toBe(10)
  })
})
