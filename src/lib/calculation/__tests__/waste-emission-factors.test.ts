import {
  WASTE_EMISSION_FACTORS,
  calculateWasteEmissions,
  type WasteDisposalMethod,
} from '../waste-emission-factors'

// [DEFRA 2024 Conversion Factors Table 8 — Waste disposal]
describe('WASTE_EMISSION_FACTORS — DEFRA Table 8 constants @regulatory', () => {
  it('LANDFILL factor is defined and positive', () => {
    expect(WASTE_EMISSION_FACTORS.LANDFILL).toBeGreaterThan(0)
  })

  it('INCINERATION_WITH_RECOVERY factor is defined and positive', () => {
    expect(WASTE_EMISSION_FACTORS.INCINERATION_WITH_RECOVERY).toBeGreaterThan(0)
  })

  it('INCINERATION_WITHOUT_RECOVERY factor is defined and positive', () => {
    expect(WASTE_EMISSION_FACTORS.INCINERATION_WITHOUT_RECOVERY).toBeGreaterThan(0)
  })

  it('RECYCLING factor is defined and non-negative', () => {
    expect(WASTE_EMISSION_FACTORS.RECYCLING).toBeGreaterThanOrEqual(0)
  })

  it('COMPOSTING factor is defined and non-negative', () => {
    expect(WASTE_EMISSION_FACTORS.COMPOSTING).toBeGreaterThanOrEqual(0)
  })

  it('TREATMENT factor is defined and non-negative', () => {
    expect(WASTE_EMISSION_FACTORS.TREATMENT).toBeGreaterThanOrEqual(0)
  })

  it('OTHER factor is defined and non-negative', () => {
    expect(WASTE_EMISSION_FACTORS.OTHER).toBeGreaterThanOrEqual(0)
  })

  // [DEFRA 2024 Table 8] landfill must exceed incineration with recovery — landfill is higher GHG
  it('LANDFILL factor exceeds INCINERATION_WITH_RECOVERY factor [DEFRA 2024 Table 8]', () => {
    expect(WASTE_EMISSION_FACTORS.LANDFILL).toBeGreaterThan(WASTE_EMISSION_FACTORS.INCINERATION_WITH_RECOVERY)
  })

  // [DEFRA 2024 Table 8] incineration without recovery exceeds with recovery
  it('INCINERATION_WITHOUT_RECOVERY factor exceeds INCINERATION_WITH_RECOVERY factor [DEFRA 2024 Table 8]', () => {
    expect(WASTE_EMISSION_FACTORS.INCINERATION_WITHOUT_RECOVERY).toBeGreaterThan(
      WASTE_EMISSION_FACTORS.INCINERATION_WITH_RECOVERY,
    )
  })

  // [DEFRA 2024 Table 8] recycling is the lowest-emission method
  it('RECYCLING factor is lower than LANDFILL factor [DEFRA 2024 Table 8]', () => {
    expect(WASTE_EMISSION_FACTORS.RECYCLING).toBeLessThan(WASTE_EMISSION_FACTORS.LANDFILL)
  })
})

// [DEFRA 2024 Conversion Factors Table 8] calculateWasteEmissions — Layer 2 pure function
describe('calculateWasteEmissions @regulatory', () => {
  it('returns kg CO2e = quantity × factor for LANDFILL [DEFRA 2024 Table 8]', () => {
    const result = calculateWasteEmissions({ quantity_tonnes: 10, disposalMethod: 'LANDFILL' })
    expect(result.co2e_kg).toBeCloseTo(10 * 1000 * WASTE_EMISSION_FACTORS.LANDFILL, 5)
    expect(result.factor_kg_per_tonne).toBe(WASTE_EMISSION_FACTORS.LANDFILL * 1000)
    expect(result.factor_source).toContain('DEFRA')
  })

  it('returns correct value for RECYCLING', () => {
    const result = calculateWasteEmissions({ quantity_tonnes: 5, disposalMethod: 'RECYCLING' })
    expect(result.co2e_kg).toBeCloseTo(5 * 1000 * WASTE_EMISSION_FACTORS.RECYCLING, 5)
  })

  it('returns correct value for INCINERATION_WITH_RECOVERY', () => {
    const result = calculateWasteEmissions({ quantity_tonnes: 2, disposalMethod: 'INCINERATION_WITH_RECOVERY' })
    expect(result.co2e_kg).toBeCloseTo(2 * 1000 * WASTE_EMISSION_FACTORS.INCINERATION_WITH_RECOVERY, 5)
  })

  it('returns correct value for INCINERATION_WITHOUT_RECOVERY', () => {
    const result = calculateWasteEmissions({ quantity_tonnes: 3, disposalMethod: 'INCINERATION_WITHOUT_RECOVERY' })
    expect(result.co2e_kg).toBeCloseTo(3 * 1000 * WASTE_EMISSION_FACTORS.INCINERATION_WITHOUT_RECOVERY, 5)
  })

  it('returns correct value for COMPOSTING', () => {
    const result = calculateWasteEmissions({ quantity_tonnes: 1, disposalMethod: 'COMPOSTING' })
    expect(result.co2e_kg).toBeCloseTo(1 * 1000 * WASTE_EMISSION_FACTORS.COMPOSTING, 5)
  })

  it('zero quantity → zero emissions regardless of method', () => {
    const methods: WasteDisposalMethod[] = ['LANDFILL', 'RECYCLING', 'COMPOSTING', 'TREATMENT', 'OTHER']
    for (const m of methods) {
      const result = calculateWasteEmissions({ quantity_tonnes: 0, disposalMethod: m })
      expect(result.co2e_kg).toBe(0)
    }
  })

  it('is a pure function — same inputs always return same outputs', () => {
    const a = calculateWasteEmissions({ quantity_tonnes: 7, disposalMethod: 'LANDFILL' })
    const b = calculateWasteEmissions({ quantity_tonnes: 7, disposalMethod: 'LANDFILL' })
    expect(a.co2e_kg).toBe(b.co2e_kg)
  })
})
