// The parser used to guess field names blind: asked "how much electricity did
// we use?" it returned `electricity_consumption`, the store holds
// `total_consumption_kwh`, the filter is exact equality, and the query matched
// nothing. The vocabulary is the fix — the model is shown the fields that exist
// and anything it invents anyway is dropped rather than filtered on.

import {
  describeVocabulary,
  resolveFieldName,
  type VocabularyEntry,
} from '../field-vocabulary'

const vocab: VocabularyEntry[] = [
  { domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'mj' },
  { domain: 'LOGISTICS', fieldName: 'declared_weight', unit: 'KG' },
  { domain: 'WASTE_AND_WATER', fieldName: 'quantity_m3', unit: 'cu.m' },
]

describe('resolveFieldName', () => {
  it('keeps a field that exists in the store', () => {
    expect(resolveFieldName('total_consumption_kwh', vocab)).toBe('total_consumption_kwh')
  })

  it('drops a field the model invented, rather than filtering on it', () => {
    // This is the exact failure: electricity_consumption is not a stored field.
    // Dropping it widens the query to the domain instead of returning nothing.
    expect(resolveFieldName('electricity_consumption', vocab)).toBeUndefined()
  })

  it('matches case-insensitively', () => {
    expect(resolveFieldName('Total_Consumption_KWH', vocab)).toBe('total_consumption_kwh')
  })

  it('tolerates spaces where the stored name uses underscores', () => {
    expect(resolveFieldName('declared weight', vocab)).toBe('declared_weight')
  })

  it('returns undefined for an absent or empty candidate', () => {
    expect(resolveFieldName(undefined, vocab)).toBeUndefined()
    expect(resolveFieldName(null, vocab)).toBeUndefined()
    expect(resolveFieldName('   ', vocab)).toBeUndefined()
  })

  it('returns undefined when the store is empty', () => {
    expect(resolveFieldName('total_consumption_kwh', [])).toBeUndefined()
  })

  it('returns the stored spelling, not the candidate spelling', () => {
    expect(resolveFieldName('DECLARED WEIGHT', vocab)).toBe('declared_weight')
  })
})

describe('describeVocabulary', () => {
  it('lists every stored field with its domain and unit', () => {
    const text = describeVocabulary(vocab)
    expect(text).toContain('total_consumption_kwh')
    expect(text).toContain('declared_weight')
    expect(text).toContain('quantity_m3')
    expect(text).toContain('ENERGY')
    expect(text).toContain('KG')
  })

  it('tells the model these are the only fields it may name', () => {
    expect(describeVocabulary(vocab)).toMatch(/only/i)
  })

  it('says plainly when the store is empty', () => {
    expect(describeVocabulary([])).toMatch(/no records|empty/i)
  })

  it('does not repeat a field that appears under several units', () => {
    const dupes: VocabularyEntry[] = [
      { domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'mj' },
      { domain: 'ENERGY', fieldName: 'total_consumption_kwh', unit: 'kWh' },
    ]
    const lines = describeVocabulary(dupes).split('\n').filter(l => l.includes('total_consumption_kwh'))
    expect(lines).toHaveLength(1)
  })
})
