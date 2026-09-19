import {
  canonicaliseMeasurement,
  resolveUnit,
  UnsupportedUnitError,
} from '../canonical-measurement'

// Every record is stored in its dimension's SI unit, whichever way it arrived —
// document, manual entry, API, integration or submission link. The conversion
// API and every aggregate assume it. A manual 100 kWh used to be stored as
// "100 kwh" while the same figure from a bill was stored as "360 mj", and the
// two could not be added together.

describe('resolveUnit', () => {
  it('recognises a supported unit whatever its case or padding', () => {
    expect(resolveUnit(' kWh ')).toEqual({ kind: 'measured', unit: 'kwh' })
    expect(resolveUnit('KG')).toEqual({ kind: 'measured', unit: 'kg' })
  })

  it('recognises the spellings documents actually use', () => {
    expect(resolveUnit('cu.m')).toEqual({ kind: 'measured', unit: 'm3' })
    expect(resolveUnit('m³')).toEqual({ kind: 'measured', unit: 'm3' })
    expect(resolveUnit('t')).toEqual({ kind: 'measured', unit: 'tonnes' })
    expect(resolveUnit('tCO2e')).toEqual({ kind: 'measured', unit: 'tonnes_co2e' })
    expect(resolveUnit('liters')).toEqual({ kind: 'measured', unit: 'litres' })
  })

  it('recognises a figure with no physical unit', () => {
    expect(resolveUnit('unknown')).toEqual({ kind: 'unitless', unit: 'unknown' })
    expect(resolveUnit('count')).toEqual({ kind: 'unitless', unit: 'count' })
    expect(resolveUnit('%')).toEqual({ kind: 'unitless', unit: 'percent' })
  })

  it('does not recognise anything else', () => {
    expect(resolveUnit('furlongs')).toBeNull()
    expect(resolveUnit('')).toBeNull()
  })
})

describe('canonicaliseMeasurement', () => {
  it('stores 100 kWh as 360 MJ, as the document path does', () => {
    expect(canonicaliseMeasurement(100, 'kwh')).toEqual({ value: 360, unit: 'mj' })
  })

  it('stores tonnes as kilograms', () => {
    expect(canonicaliseMeasurement(2.5, 'tonnes')).toEqual({ value: 2500, unit: 'kg' })
  })

  it('leaves an already-canonical figure alone', () => {
    expect(canonicaliseMeasurement(360, 'mj')).toEqual({ value: 360, unit: 'mj' })
  })

  it('keeps a unitless figure as it is, under its canonical name', () => {
    expect(canonicaliseMeasurement(12, 'Count')).toEqual({ value: 12, unit: 'count' })
  })

  it('refuses a unit it cannot convert, rather than storing something no total can use', () => {
    expect(() => canonicaliseMeasurement(5, 'furlongs')).toThrow(UnsupportedUnitError)
  })
})
