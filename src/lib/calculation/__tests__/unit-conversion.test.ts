import {
  kwhToMj,
  thermsToMj,
  tonnesToKg,
  shortTonsToKg,
  litresToM3,
  hectaresToM2,
  milesToKm,
  normaliseToSI,
} from '../unit-conversion'

describe('unit-conversion — @regulatory', () => {
  it('[DEFRA 2024] kWh to MJ: 1 kWh = 3.6 MJ (SI definition)', () => {
    expect(kwhToMj(1)).toBe(3.6)
    expect(kwhToMj(0)).toBe(0)
    expect(kwhToMj(1000)).toBe(3600)
  })

  it('[DEFRA 2024] therm (UK) to MJ: 1 therm = 105.505585 MJ', () => {
    expect(thermsToMj(1)).toBeCloseTo(105.505585, 6)
  })

  it('[GHG Protocol Scope 3 Standard Ch.7] tonne to kg: 1 tonne = 1000 kg (exact)', () => {
    expect(tonnesToKg(1)).toBe(1000)
    expect(tonnesToKg(5.5)).toBe(5500)
  })

  it('[GHG Protocol Scope 3 Standard] short ton (US) to kg: 1 short ton = 907.18474 kg', () => {
    expect(shortTonsToKg(1)).toBeCloseTo(907.18474, 5)
  })

  it('[SI definition] litre to m³: 1 litre = 0.001 m³ (exact)', () => {
    expect(litresToM3(1000)).toBe(1)
    expect(litresToM3(1)).toBe(0.001)
  })

  it('[SI definition] hectare to m²: 1 hectare = 10,000 m² (exact)', () => {
    expect(hectaresToM2(1)).toBe(10000)
    expect(hectaresToM2(0.5)).toBe(5000)
  })

  it('[international definition] mile to km: 1 mile = 1.609344 km (exact)', () => {
    expect(milesToKm(1)).toBe(1.609344)
  })
})

describe('normaliseToSI', () => {
  it('kwh → mj', () => {
    const r = normaliseToSI(100, 'kwh')
    expect(r.siUnit).toBe('mj')
    expect(r.value).toBe(360)
  })

  it('gj → mj (× 1000)', () => {
    const r = normaliseToSI(1, 'gj')
    expect(r.siUnit).toBe('mj')
    expect(r.value).toBe(1000)
  })

  it('tonnes → kg', () => {
    const r = normaliseToSI(2, 'tonnes')
    expect(r.siUnit).toBe('kg')
    expect(r.value).toBe(2000)
  })

  it('tonnes_co2e → kg_co2e (× 1000)', () => {
    const r = normaliseToSI(1.5, 'tonnes_co2e')
    expect(r.siUnit).toBe('kg_co2e')
    expect(r.value).toBe(1500)
  })

  it('nautical_miles → km (× 1.852)', () => {
    const r = normaliseToSI(10, 'nautical_miles')
    expect(r.siUnit).toBe('km')
    expect(r.value).toBeCloseTo(18.52, 5)
  })
})
