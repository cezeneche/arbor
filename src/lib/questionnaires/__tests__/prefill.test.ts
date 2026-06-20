import { prefillQuestionnaire, type PrefillInputRecord } from '../prefill'
import type { QuestionnaireTemplate } from '../types'

// A minimal template exercising all three modes.
const template: QuestionnaireTemplate = {
  id: 'test',
  name: 'Test',
  framework: 'Test',
  description: 'Test template',
  status: 'available',
  questions: [
    {
      id: 'total_emissions',
      text: 'What were your total reported emissions?',
      mode: 'direct',
      domain: 'EMISSIONS',
      fieldName: 'total_co2e',
      unit: 'tonnes_co2e',
    },
    {
      id: 'annual_electricity',
      text: 'What was your annual electricity consumption?',
      mode: 'assemble',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      unit: 'kwh',
    },
    {
      id: 'electricity_for_factor',
      text: 'List your electricity records for emissions calculation.',
      mode: 'collection',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
    },
    {
      id: 'water_use',
      text: 'What was your water consumption?',
      mode: 'assemble',
      domain: 'WASTE_AND_WATER',
      fieldName: 'quantity_m3',
      unit: 'm3',
    },
  ],
}

function rec(over: Partial<PrefillInputRecord>): PrefillInputRecord {
  return {
    id: 'r1',
    domain: 'ENERGY',
    fieldName: 'total_consumption_kwh',
    value: 100,
    unit: 'kwh',
    trustTier: 'A',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-03-31T00:00:00.000Z',
    ...over,
  }
}

describe('prefillQuestionnaire', () => {
  it('returns one answer per question', () => {
    const answers = prefillQuestionnaire(template, [])
    expect(answers).toHaveLength(template.questions.length)
  })

  it('a question with no matching records returns status "gap"', () => {
    const answers = prefillQuestionnaire(template, [])
    const water = answers.find((a) => a.questionId === 'water_use')!
    expect(water.status).toBe('gap')
    expect(water.value).toBeNull()
    expect(water.trustTier).toBeNull()
    expect(water.sourceRecordIds).toEqual([])
  })

  it('direct mode fills the single canonical value with its tier and source id', () => {
    const records = [
      rec({ id: 'co2-1', domain: 'EMISSIONS', fieldName: 'total_co2e', value: 1200, unit: 'tonnes_co2e', trustTier: 'A' }),
    ]
    const answers = prefillQuestionnaire(template, records)
    const ans = answers.find((a) => a.questionId === 'total_emissions')!
    expect(ans.status).toBe('answered')
    expect(ans.value).toBe(1200)
    expect(ans.unit).toBe('tonnes_co2e')
    expect(ans.trustTier).toBe('A')
    expect(ans.sourceRecordIds).toEqual(['co2-1'])
    expect(ans.contributingCount).toBe(1)
  })

  it('direct mode chooses the most recent record when several match', () => {
    const records = [
      rec({ id: 'co2-old', domain: 'EMISSIONS', fieldName: 'total_co2e', value: 1000, unit: 'tonnes_co2e', periodEnd: '2025-12-31T00:00:00.000Z' }),
      rec({ id: 'co2-new', domain: 'EMISSIONS', fieldName: 'total_co2e', value: 1500, unit: 'tonnes_co2e', periodEnd: '2026-12-31T00:00:00.000Z' }),
    ]
    const ans = prefillQuestionnaire(template, records).find((a) => a.questionId === 'total_emissions')!
    expect(ans.value).toBe(1500)
    expect(ans.sourceRecordIds).toEqual(['co2-new'])
  })

  it('assemble mode sums identical-unit records and reports the count', () => {
    const records = [
      rec({ id: 'q1', value: 250, unit: 'kwh' }),
      rec({ id: 'q2', value: 300, unit: 'kwh' }),
      rec({ id: 'q3', value: 275, unit: 'kwh' }),
      rec({ id: 'q4', value: 225, unit: 'kwh' }),
    ]
    const ans = prefillQuestionnaire(template, records).find((a) => a.questionId === 'annual_electricity')!
    expect(ans.status).toBe('answered')
    expect(ans.value).toBe(1050)
    expect(ans.unit).toBe('kwh')
    expect(ans.contributingCount).toBe(4)
    expect(ans.sourceRecordIds).toEqual(['q1', 'q2', 'q3', 'q4'])
    expect(ans.note).toBe('Σ of 4 records')
  })

  it('assemble mode sums ONLY records whose unit matches the question unit', () => {
    const records = [
      rec({ id: 'kwh1', value: 250, unit: 'kwh' }),
      rec({ id: 'kwh2', value: 300, unit: 'kwh' }),
      rec({ id: 'mj1', value: 9999, unit: 'mj' }), // wrong unit, must be excluded
    ]
    const ans = prefillQuestionnaire(template, records).find((a) => a.questionId === 'annual_electricity')!
    expect(ans.value).toBe(550)
    expect(ans.contributingCount).toBe(2)
    expect(ans.sourceRecordIds).toEqual(['kwh1', 'kwh2'])
  })

  it("an answer's tier equals the worst contributing record's tier (A→B→C)", () => {
    const records = [
      rec({ id: 'a1', value: 100, unit: 'kwh', trustTier: 'A' }),
      rec({ id: 'b1', value: 100, unit: 'kwh', trustTier: 'B' }),
    ]
    const ans = prefillQuestionnaire(template, records).find((a) => a.questionId === 'annual_electricity')!
    expect(ans.trustTier).toBe('B')

    const withC = [...records, rec({ id: 'c1', value: 100, unit: 'kwh', trustTier: 'C' })]
    const ans2 = prefillQuestionnaire(template, withC).find((a) => a.questionId === 'annual_electricity')!
    expect(ans2.trustTier).toBe('C')
  })

  it('collection mode lists contributing records without summing', () => {
    const records = [
      rec({ id: 'e1', value: 250, unit: 'kwh', trustTier: 'A' }),
      rec({ id: 'e2', value: 300, unit: 'kwh', trustTier: 'B' }),
    ]
    const ans = prefillQuestionnaire(template, records).find((a) => a.questionId === 'electricity_for_factor')!
    expect(ans.status).toBe('answered')
    expect(ans.value).toBeNull()
    expect(ans.trustTier).toBe('B') // worst of contributing
    expect(ans.contributingCount).toBe(2)
    expect(ans.contributingRecords).toHaveLength(2)
    expect(ans.contributingRecords[0]).toMatchObject({ recordId: 'e1', value: 250, unit: 'kwh', trustTier: 'A' })
  })

  it('accepts Date objects for periods as well as ISO strings', () => {
    const records = [
      rec({ id: 'd1', domain: 'EMISSIONS', fieldName: 'total_co2e', value: 42, unit: 'tonnes_co2e', periodEnd: new Date('2026-06-30T00:00:00.000Z') }),
    ]
    const ans = prefillQuestionnaire(template, records).find((a) => a.questionId === 'total_emissions')!
    expect(ans.value).toBe(42)
    expect(ans.contributingRecords[0].periodEnd).toBe('2026-06-30T00:00:00.000Z')
  })
})
