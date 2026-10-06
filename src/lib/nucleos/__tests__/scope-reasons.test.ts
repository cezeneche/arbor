import { relevantScopeReasons, scopeAnswer } from '../scope-reasons'

// The scope check asks for a commodity code and a tonnage. It does not ask for
// an EORI or an origin, so telling the user those were "not provided" is
// telling them off for not answering a question that was never put to them.
// The reasons that decided the answer must always survive.

describe('relevantScopeReasons', () => {
  it('keeps the reason the answer actually turned on', () => {
    const kept = relevantScopeReasons([
      'annex_i:not_covered:72882700 — CN code is not listed in CBAM Annex I',
    ])
    expect(kept).toHaveLength(1)
  })

  it('drops the threshold reasons, which the screen states in its own words instead', () => {
    // scopeThresholdNotes turns these into a note for the organisation's regime.
    expect(
      relevantScopeReasons([
        'de_minimis:annual_mass_threshold:50t — an importer is exempt only if ...',
        'de_minimis:not_available:hydrogen — the 50-tonne annual exemption does not cover hydrogen',
      ]),
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

// Nucleos answers "requires_review" whenever origin or EORI is missing. This
// screen sends neither, so every covered code came back "needs a closer look",
// with no estimate, for questions nobody was asked. The screen answers from the
// code alone and says so; a review is only shown when something was found.

describe('scopeAnswer', () => {
  const covered = 'annex_i:covered:72081000:sector=iron_steel — CN code is covered by CBAM Annex I'
  const asCodeAlone = [
    covered,
    'origin:missing — origin country not provided; cannot confirm Annex II exclusion',
    'de_minimis:annual_mass_threshold:50t — an importer is exempt only if ...',
    'eori:missing — importer EORI not provided',
  ]

  it('is in scope when the only open questions are ones this screen never asks', () => {
    expect(scopeAnswer('requires_review', asCodeAlone)).toBe('in_scope')
  })

  it('stays a review when Nucleos found something wrong', () => {
    expect(
      scopeAnswer('requires_review', [
        ...asCodeAlone,
        "eori:format_invalid:'X' — does not match EU EORI format",
      ]),
    ).toBe('requires_review')
  })

  it('never turns an exclusion into an answer of in scope', () => {
    expect(scopeAnswer('out_of_scope', ['annex_i:not_covered:84713000 — not listed'])).toBe('out_of_scope')
    expect(
      scopeAnswer('out_of_scope', [covered, 'origin:annex_ii:NO — country is listed in CBAM Annex II']),
    ).toBe('out_of_scope')
  })

  it('leaves in scope alone', () => {
    expect(scopeAnswer('in_scope', [covered])).toBe('in_scope')
  })

  it('is out of scope for electricity when the organisation files in the UK only', () => {
    // The UK does not cover electricity; the code list Nucleos checks is the EU's.
    const electricity = ['annex_i:covered:27160000:sector=electricity — CN code is covered']
    expect(scopeAnswer('requires_review', electricity, { sector: 'electricity', jurisdiction: 'UK' })).toBe(
      'out_of_scope',
    )
    expect(scopeAnswer('requires_review', electricity, { sector: 'electricity', jurisdiction: 'BOTH' })).toBe(
      'in_scope',
    )
    expect(scopeAnswer('requires_review', electricity, { sector: 'electricity', jurisdiction: 'EU' })).toBe(
      'in_scope',
    )
    expect(scopeAnswer('requires_review', asCodeAlone, { sector: 'iron_steel', jurisdiction: 'UK' })).toBe(
      'in_scope',
    )
  })
})
