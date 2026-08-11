import { relevantScopeReasons } from '../scope-reasons'

// The scope check asks for a commodity code and a tonnage. It does not ask for
// an EORI or a consignment value, so telling the user those were "not provided"
// is telling them off for not answering a question that was never put to them.
// The reasons that decided the answer must always survive.

describe('relevantScopeReasons', () => {
  it('keeps the reason the answer actually turned on', () => {
    const kept = relevantScopeReasons([
      'annex_i:not_covered:72882700 — CN code is not listed in CBAM Annex I',
    ])
    expect(kept).toHaveLength(1)
  })

  it('drops a de minimis check that was skipped for want of an input we never ask for', () => {
    expect(
      relevantScopeReasons(['de_minimis:value_not_provided — consignment value not provided']),
    ).toEqual([])
  })

  it('drops a missing EORI, which this screen does not collect', () => {
    expect(relevantScopeReasons(['eori:missing — importer EORI not provided'])).toEqual([])
  })

  it('keeps an EORI reason that reports something wrong rather than absent', () => {
    // An invalid EORI is a finding. A missing one is a question we did not ask.
    const kept = relevantScopeReasons(['eori:invalid_format — EORI does not match the EU format'])
    expect(kept).toHaveLength(1)
  })

  it('keeps an origin exclusion, which is a real determination', () => {
    const kept = relevantScopeReasons([
      'origin:annex_ii:NO — country is listed in CBAM Annex II (EEA/linked ETS)',
    ])
    expect(kept).toHaveLength(1)
  })

  it('drops an origin reason that only says none was given', () => {
    expect(relevantScopeReasons(['origin:not_provided — country of origin not provided'])).toEqual([])
  })

  it('never returns empty when every reason was noise but one decided it', () => {
    const kept = relevantScopeReasons([
      'annex_i:covered:72071111 — CN code is listed in CBAM Annex I',
      'de_minimis:value_not_provided — consignment value not provided',
      'eori:missing — importer EORI not provided',
    ])
    expect(kept).toEqual(['annex_i:covered:72071111 — CN code is listed in CBAM Annex I'])
  })

  it('keeps everything when nothing matches the noise patterns', () => {
    const reasons = ['something_new:happened — a reason we have not seen before']
    expect(relevantScopeReasons(reasons)).toEqual(reasons)
  })
})
