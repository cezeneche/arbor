import { summariseFieldAnswer, provenanceNote, buildAnswerHtml, worstTier } from '../answer-email'

describe('summariseFieldAnswer', () => {
  it('totals records that share a unit', () => {
    expect(
      summariseFieldAnswer([
        { value: 100, unit: 'kWh', trustTier: 'A' },
        { value: 250, unit: 'kWh', trustTier: 'A' },
      ]),
    ).toEqual([{ total: 350, unit: 'kWh', tier: 'Verified' }])
  })

  // The defect: everything was summed and labelled with the first record's unit,
  // so 40,000 kWh plus 12 MJ was emailed to a buyer as "40,012 kWh".
  it('does not add across units — it reports each unit separately', () => {
    expect(
      summariseFieldAnswer([
        { value: 40000, unit: 'kWh', trustTier: 'A' },
        { value: 12, unit: 'MJ', trustTier: 'A' },
      ]),
    ).toEqual([
      { total: 40000, unit: 'kWh', tier: 'Verified' },
      { total: 12, unit: 'MJ', tier: 'Verified' },
    ])
  })

  it('carries the worst tier of the records behind each line', () => {
    expect(
      summariseFieldAnswer([
        { value: 1, unit: 'kWh', trustTier: 'A' },
        { value: 2, unit: 'kWh', trustTier: 'B' },
        { value: 5, unit: 'MJ', trustTier: 'A' },
      ]),
    ).toEqual([
      { total: 3, unit: 'kWh', tier: 'Declared' },
      { total: 5, unit: 'MJ', tier: 'Verified' },
    ])
  })

  it('handles no records at all', () => {
    expect(summariseFieldAnswer([])).toEqual([])
  })
})

describe('provenanceNote', () => {
  // The defect: the email told the buyer every value was backed by a source
  // document, which is false for manual and integration Tier B records.
  it('claims document backing only when every value is Verified', () => {
    const note = provenanceNote([
      { fieldName: 'x', records: [{ value: 1, unit: 'kWh', trustTier: 'A' }] },
    ])
    expect(note).toContain('Verified')
    expect(note).toContain('source document')
    expect(note).not.toContain('Declared')
  })

  it('explains the mixture when the answer is not all Verified', () => {
    const note = provenanceNote([
      { fieldName: 'x', records: [{ value: 1, unit: 'kWh', trustTier: 'A' }] },
      { fieldName: 'y', records: [{ value: 2, unit: 'kg', trustTier: 'B' }] },
    ])
    expect(note).toContain('Declared')
    expect(note).toContain('Estimated')
  })

  it('says nothing when there is nothing to describe', () => {
    expect(provenanceNote([])).toBe('')
  })
})

describe('buildAnswerHtml', () => {
  it('emits one row per unit for a field with mixed units', () => {
    const html = buildAnswerHtml('Sheffield Steel Ltd', [
      {
        fieldName: 'total_consumption_kwh',
        records: [
          { value: 40000, unit: 'kWh', trustTier: 'A' },
          { value: 12, unit: 'MJ', trustTier: 'B' },
        ],
      },
    ])
    expect(html).toContain('40000 kWh')
    expect(html).toContain('12 MJ')
    expect(html).not.toContain('40012')
  })

  it('escapes entity names and field names', () => {
    const html = buildAnswerHtml('<script>x</script>', [
      { fieldName: '<b>f</b>', records: [{ value: 1, unit: 'kg', trustTier: 'A' }] },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('worstTier', () => {
  it('reports the least-verified tier present', () => {
    expect(worstTier(['A', 'B'])).toBe('Declared')
    expect(worstTier(['A', 'C', 'B'])).toBe('Estimated')
    expect(worstTier(['A'])).toBe('Verified')
    expect(worstTier([])).toBe('')
  })
})
