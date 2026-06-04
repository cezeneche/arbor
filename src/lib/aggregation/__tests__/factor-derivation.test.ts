import {
  deriveEmissionFactors,
  deriveAllFactors,
  FACTOR_MIN_SAMPLE,
} from '../factor-derivation'

const baseRecord = {
  domain: 'ENERGY',
  fieldName: 'electricity_kwh',
  value: 0.233,
  unit: 'kg CO2e/kWh',
}

function makeRecords(count: number, value = 0.233, unit = 'kg CO2e/kWh') {
  return Array.from({ length: count }, (_, i) => ({
    ...baseRecord,
    entityId: `e${i}`,
    value,
    unit,
  }))
}

describe('deriveEmissionFactors', () => {
  it('returns null when sample is below the minimum threshold', () => {
    const records = makeRecords(FACTOR_MIN_SAMPLE - 1)
    const result = deriveEmissionFactors({ records, activityType: 'ENERGY_electricity_kwh', year: 2026 })
    expect(result).toBeNull()
  })

  it('returns a result at the minimum sample size', () => {
    const records = makeRecords(FACTOR_MIN_SAMPLE)
    const result = deriveEmissionFactors({ records, activityType: 'ENERGY_electricity_kwh', year: 2026 })
    expect(result).not.toBeNull()
    expect(result!.sampleSize).toBe(FACTOR_MIN_SAMPLE)
  })

  it('returns null when records have mixed units', () => {
    const records = [
      { ...baseRecord, unit: 'kg CO2e/kWh' },
      { ...baseRecord, unit: 'tonnes CO2e/MWh' },
      { ...baseRecord, unit: 'kg CO2e/kWh' },
      { ...baseRecord, unit: 'kg CO2e/kWh' },
      { ...baseRecord, unit: 'kg CO2e/kWh' },
    ]
    const result = deriveEmissionFactors({ records, activityType: 'test', year: 2026 })
    expect(result).toBeNull()
  })

  it('computes the mean correctly for uniform values', () => {
    const records = makeRecords(10, 0.5)
    const result = deriveEmissionFactors({ records, activityType: 'test', year: 2026 })
    expect(result!.factor).toBeCloseTo(0.5)
  })

  it('computes the mean correctly for varied values', () => {
    const values = [0.2, 0.3, 0.4, 0.2, 0.3]
    const records = values.map((v, i) => ({ ...baseRecord, entityId: `e${i}`, value: v }))
    const result = deriveEmissionFactors({ records, activityType: 'test', year: 2026 })
    expect(result!.factor).toBeCloseTo(0.28)
  })

  it('produces a 95% CI where lower < mean < upper', () => {
    const values = [0.2, 0.3, 0.25, 0.35, 0.28, 0.22]
    const records = values.map((v, i) => ({ ...baseRecord, entityId: `e${i}`, value: v }))
    const result = deriveEmissionFactors({ records, activityType: 'test', year: 2026 })!
    expect(result.confidenceIntervalLower).toBeLessThan(result.factor)
    expect(result.confidenceIntervalUpper).toBeGreaterThan(result.factor)
  })

  it('includes the sector in the citation when provided', () => {
    const records = makeRecords(6)
    const result = deriveEmissionFactors({ records, activityType: 'test', sector: 'steel', year: 2026 })
    expect(result!.citation).toContain('steel')
  })

  it('sets activityType on the result', () => {
    const records = makeRecords(6)
    const result = deriveEmissionFactors({ records, activityType: 'ENERGY_electricity_kwh', year: 2026 })
    expect(result!.activityType).toBe('ENERGY_electricity_kwh')
  })
})

describe('deriveAllFactors', () => {
  it('returns factors for each domain+fieldName group with sufficient records', () => {
    const energyRecords = makeRecords(6, 0.233, 'kg CO2e/kWh')
    const fuelRecords = makeRecords(6, 2.68, 'kg CO2e/litre').map(r => ({
      ...r,
      fieldName: 'fuel_litres',
    }))
    const results = deriveAllFactors({ records: [...energyRecords, ...fuelRecords], year: 2026 })
    expect(results).toHaveLength(2)
  })

  it('omits groups below the minimum sample size', () => {
    const enough = makeRecords(6)
    const tooFew = makeRecords(3).map((r, i) => ({ ...r, entityId: `x${i}`, fieldName: 'gas_m3' }))
    const results = deriveAllFactors({ records: [...enough, ...tooFew], year: 2026 })
    expect(results).toHaveLength(1)
    expect(results[0].activityType).toBe('ENERGY_electricity_kwh')
  })
})
