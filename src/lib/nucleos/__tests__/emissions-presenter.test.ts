import { presentCalculation, presentLine } from '../emissions-presenter'
import type { CalculatedLine, CalculationResult } from '../contract'

function line(overrides: Partial<CalculatedLine> = {}): CalculatedLine {
  return {
    line_id: 'gl-1',
    emissions_method: 'ACTUAL',
    provenance_tier: 'VERIFIED',
    direct_kgco2e: 43200,
    indirect_kgco2e: 0,
    see_total_tco2e_per_t: 1.8,
    embedded_tco2e: 43.2,
    markup_fraction: 0,
    rejected_methods: [],
    decision_trace: [],
    warnings: [],
    ...overrides,
  }
}

function result(overrides: Partial<CalculationResult> = {}): CalculationResult {
  return {
    case_reference: 'case-1',
    jurisdiction: 'UK',
    reporting_year: 2027,
    reporting_quarter: 1,
    lines: [line()],
    total_embedded_tco2e: 43.2,
    warnings: [],
    engine: {
      engine_version: '2.4.0',
      annex_vi_factor_version: 'annex-vi-2024.1',
      markup_table_version: 'markup-2027',
      regulation_reference: 'Commission Implementing Regulation (EU) 2023/1773',
    },
    ...overrides,
  }
}

describe('presentLine', () => {
  // The single most important property of this screen. A mill certificate can
  // be an ACTUAL measurement on a DECLARED record, and a reviewer needs both.
  it('shows both axes independently', () => {
    const p = presentLine(line({ emissions_method: 'ACTUAL', provenance_tier: 'DECLARED' }))
    expect(p.method).toBe('Measured')
    expect(p.provenance).toBe('Declared')
  })

  it('never derives one axis from the other', () => {
    const defaulted = presentLine(
      line({ emissions_method: 'DEFAULT', provenance_tier: 'VERIFIED' }),
    )
    expect(defaulted.method).toBe('Published default')
    expect(defaulted.provenance).toBe('Verified')
  })

  it('keeps a rejected method’s reason and its regulation reference', () => {
    const p = presentLine(
      line({
        emissions_method: 'DEFAULT',
        rejected_methods: [
          {
            method: 'ACTUAL',
            regulation_tier: 1,
            reason: 'No installation-level figure was supplied',
            regulation_ref: 'EU 2023/1773 Art. 4(2)',
          },
        ],
      }),
    )

    expect(p.rejections).toHaveLength(1)
    expect(p.rejections[0]).toEqual({
      method: 'Measured',
      reason: 'No installation-level figure was supplied',
      regulationRef: 'EU 2023/1773 Art. 4(2)',
    })
  })

  // The mark-up is deliberate policy and the reason a default figure is higher.
  // A user looking at an unexpected number is owed the reason.
  it('names the mark-up when one applied, with the engine’s own percentage', () => {
    const p = presentLine(line({ emissions_method: 'DEFAULT', markup_fraction: 0.2 }))
    expect(p.markupNote).toMatch(/20%/)
    expect(p.markupNote).toMatch(/mark-up/)
  })

  it('says nothing about a mark-up when none applied', () => {
    expect(presentLine(line({ markup_fraction: 0 })).markupNote).toBeNull()
    expect(presentLine(line({ markup_fraction: null })).markupNote).toBeNull()
  })

  it('formats emissions in tonnes and intensity per tonne', () => {
    const p = presentLine(line({ direct_kgco2e: 43200, see_total_tco2e_per_t: 1.8 }))
    expect(p.direct).toBe('43.20 tCO2e')
    expect(p.seeTotal).toBe('1.800 tCO2e/t')
  })

  // An em-dash, not a zero. A zero reads as "no emissions"; the opposite of
  // "not known".
  it('shows an em-dash rather than a zero for a missing intensity', () => {
    expect(presentLine(line({ see_total_tco2e_per_t: null })).seeTotal).toBe('—')
  })

  it('carries the decision trace and warnings through verbatim', () => {
    const trace = [
      {
        step: 'method_selection',
        outcome: 'default',
        detail: 'no supplier figure',
        regulation_ref: 'EU 2023/1773 Art. 4',
      },
    ]
    const p = presentLine(line({ decision_trace: trace, warnings: ['cbam_factors:world_avg'] }))
    expect(p.trace).toEqual(trace)
    expect(p.warnings).toEqual(['cbam_factors:world_avg'])
  })
})

describe('presentCalculation', () => {
  it('formats the period and the total', () => {
    const p = presentCalculation(result())
    expect(p.period).toBe('Q1 2027')
    expect(p.totalEmbedded).toBe('43.20 tCO2e')
  })

  it('drops the quarter from the period when the case has none', () => {
    expect(presentCalculation(result({ reporting_quarter: null })).period).toBe('2027')
  })

  // Reproducibility. Regulatory tables are versioned because they move; a
  // figure that cannot name the versions behind it cannot be re-derived later.
  it('stamps every table version that produced the figures', () => {
    const stamp = presentCalculation(result()).provenanceStamp
    expect(stamp).toContain('engine 2.4.0')
    expect(stamp).toContain('annex-vi-2024.1')
    expect(stamp).toContain('markup-2027')
    expect(stamp).toContain('2023/1773')
  })

  it('shows an em-dash rather than zero when the engine returned no total', () => {
    expect(presentCalculation(result({ total_embedded_tco2e: null })).totalEmbedded).toBe('—')
  })
})
