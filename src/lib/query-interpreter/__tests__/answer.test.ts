// The query assistant's grounding layer. Everything Claude is allowed to say
// about a company's data has to come from this evidence block, and the block
// carries the trust tier on every line — provenance can never be stripped
// (PRD §20.2), and the assistant is never permitted to calculate (PRD §15.3).

import {
  buildEvidenceBlock,
  buildAnswerSystemPrompt,
  answerWithoutModel,
  type AnswerRecord,
} from '../answer'

const rec = (over: Partial<AnswerRecord> = {}): AnswerRecord => ({
  entityName: 'Midlands Steel Ltd',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 1234.5,
  unit: 'kWh',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-03-31T00:00:00.000Z',
  trustTier: 'A',
  sourceText: 'Total consumption 1,234.5 kWh',
  ...over,
})

describe('buildEvidenceBlock', () => {
  it('says plainly that nothing was found when there are no records', () => {
    const block = buildEvidenceBlock([])
    expect(block).toMatch(/no records/i)
  })

  it('puts the trust tier on every record line', () => {
    const block = buildEvidenceBlock([rec({ trustTier: 'A' }), rec({ trustTier: 'C' })])
    const lines = block.split('\n').filter(l => l.includes('total_consumption_kwh'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/Verified/)
    expect(lines[1]).toMatch(/Estimated/)
  })

  it('carries value, unit, period and owning company on each line', () => {
    const block = buildEvidenceBlock([rec()])
    expect(block).toContain('1234.5')
    expect(block).toContain('kWh')
    expect(block).toContain('2026-01-01')
    expect(block).toContain('2026-03-31')
    expect(block).toContain('Midlands Steel Ltd')
  })

  it('caps the evidence and states how many records were left out', () => {
    const records = Array.from({ length: 12 }, (_, i) => rec({ value: i }))
    const block = buildEvidenceBlock(records, { limit: 5 })
    const lines = block.split('\n').filter(l => l.includes('total_consumption_kwh'))
    expect(lines).toHaveLength(5)
    expect(block).toMatch(/7 further record/i)
  })

  it('does not claim records were omitted when they all fit', () => {
    const block = buildEvidenceBlock([rec(), rec()], { limit: 5 })
    expect(block).not.toMatch(/further record/i)
  })
})

describe('buildAnswerSystemPrompt', () => {
  it('forbids calculating, deriving or converting', () => {
    const prompt = buildAnswerSystemPrompt({ plainEnglish: false })
    expect(prompt).toMatch(/do not (calculate|add|sum)/i)
    expect(prompt).toMatch(/convert/i)
  })

  it('forbids stating anything not present in the evidence', () => {
    const prompt = buildAnswerSystemPrompt({ plainEnglish: false })
    expect(prompt).toMatch(/only.*(evidence|records below)/i)
  })

  it('requires the certification of each figure to travel with it', () => {
    const prompt = buildAnswerSystemPrompt({ plainEnglish: false })
    expect(prompt).toMatch(/Verified|Declared|Estimated/)
  })

  it('drops technical vocabulary for supplier-facing answers', () => {
    const plain = buildAnswerSystemPrompt({ plainEnglish: true })
    expect(plain).not.toMatch(/tier [ABC]\b/i)
    expect(plain).toMatch(/plain English/i)
  })
})

describe('answerWithoutModel', () => {
  // The records are the product. If the assistant is unavailable the table must
  // still be answerable — the page degrades to a plain sentence, never an error.
  it('summarises a hit without inventing a figure', () => {
    const text = answerWithoutModel({ recordCount: 3, interpretation: 'energy records for 2026' })
    expect(text).toMatch(/3/)
    expect(text).toMatch(/energy records for 2026/)
  })

  it('says plainly when nothing matched', () => {
    const text = answerWithoutModel({ recordCount: 0, interpretation: 'waste records for 2020' })
    expect(text).toMatch(/no|nothing/i)
  })
})
