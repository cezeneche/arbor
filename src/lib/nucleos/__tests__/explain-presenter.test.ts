import { presentExplanation } from '../explain-presenter'

// "Why this number?" — what the figure is, the words on the document it came
// from, how sure the reading was, and whether a person corrected it. In plain
// English: this is read by the importer, not an auditor.

describe('presentExplanation', () => {
  it('shows the document text each value was read from, with a link to the document', () => {
    const out = presentExplanation({
      chosen_value: 24000,
      evidence: [
        {
          field: 'goods_lines.gl-1.net_mass_kg',
          value: 24000,
          source: 'arbor_extraction',
          confidence: 0.8,
          snippet: 'Net mass | 24 000 kg',
          source_ref: 'arbor:document:doc-1',
        },
      ],
    })
    expect(out).toEqual({
      available: true,
      sources: [
        {
          text: 'Net mass | 24 000 kg',
          how: 'Read from the document (80% sure).',
          documentHref: '/upload/doc-1/review',
        },
      ],
    })
  })

  it('says when a person corrected what was read', () => {
    const out = presentExplanation({
      evidence: [
        {
          field: 'f',
          value: 24000,
          source: 'arbor_reviewer_corrected',
          confidence: 1,
          snippet: 'Net mass | 24 500 kg',
          source_ref: 'arbor:document:doc-1',
        },
      ],
    })
    expect(out.sources[0].how).toBe(
      'Corrected by a person on review. The document text is shown as it was read.',
    )
  })

  it('does not link a source it cannot place', () => {
    const out = presentExplanation({
      evidence: [
        { field: 'f', source: 'customs_parser', confidence: 0.9, snippet: 'x', source_ref: 'somewhere-else' },
      ],
    })
    expect(out.sources[0].documentHref).toBeNull()
  })

  it('says plainly when nothing was recorded', () => {
    expect(presentExplanation(null)).toEqual({ available: false, sources: [] })
    expect(presentExplanation({ evidence: [] })).toEqual({ available: false, sources: [] })
  })
})
