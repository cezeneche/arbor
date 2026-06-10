// Layer 3  -  Unit Conversion. Pure functions only  -  no DB reads, no API calls, no side effects.
// Converts stored SI values to recipient-requested units on output. Never modifies stored data.
// PRD Section 14  -  supported conversion dimensions and constraints.

// ── TO-SI (used at ingestion time, Layer 2) ───────────────────────────────────

export type SupportedUnit =
  // Energy (SI: mj)
  | 'mj' | 'kwh' | 'gj' | 'btu' | 'therms' | 'toe' | 'kcal'
  // Mass (SI: kg)
  | 'kg' | 'tonnes' | 'g' | 'lbs' | 'short_tons' | 'long_tons' | 'oz'
  // Volume (SI: m3)
  | 'm3' | 'litres' | 'ml' | 'gallons_uk' | 'gallons_us' | 'barrels' | 'ft3'
  // Area (SI: m2)
  | 'm2' | 'hectares' | 'acres' | 'km2' | 'ft2' | 'yd2'
  // Distance (SI: km)
  | 'km' | 'miles' | 'nautical_miles' | 'm'
  // Emissions (SI: kg_co2e)
  | 'kg_co2e' | 'tonnes_co2e' | 'g_co2e' | 'lbs_co2e'

export type SIDimension = 'mj' | 'kg' | 'm3' | 'm2' | 'km' | 'kg_co2e'

export function normaliseToSI(value: number, unit: SupportedUnit): { value: number; siUnit: SIDimension } {
  switch (unit) {
    // Energy
    case 'kwh':           return { value: value * 3.6,          siUnit: 'mj' }
    case 'mj':            return { value,                        siUnit: 'mj' }
    case 'gj':            return { value: value * 1000,          siUnit: 'mj' }
    case 'btu':           return { value: value * 0.00105506,    siUnit: 'mj' }
    case 'therms':        return { value: value * 105.505585,    siUnit: 'mj' }
    case 'toe':           return { value: value * 41868,         siUnit: 'mj' }
    case 'kcal':          return { value: value * 0.004184,      siUnit: 'mj' }
    // Mass
    case 'kg':            return { value,                        siUnit: 'kg' }
    case 'tonnes':        return { value: value * 1000,          siUnit: 'kg' }
    case 'g':             return { value: value * 0.001,         siUnit: 'kg' }
    case 'lbs':           return { value: value * 0.453592,      siUnit: 'kg' }
    case 'short_tons':    return { value: value * 907.18474,     siUnit: 'kg' }
    case 'long_tons':     return { value: value * 1016.0469,     siUnit: 'kg' }
    case 'oz':            return { value: value * 0.0283495,     siUnit: 'kg' }
    // Volume
    case 'm3':            return { value,                        siUnit: 'm3' }
    case 'litres':        return { value: value * 0.001,         siUnit: 'm3' }
    case 'ml':            return { value: value * 0.000001,      siUnit: 'm3' }
    case 'gallons_uk':    return { value: value * 0.00454609,    siUnit: 'm3' }
    case 'gallons_us':    return { value: value * 0.00378541,    siUnit: 'm3' }
    case 'barrels':       return { value: value * 0.158987,      siUnit: 'm3' }
    case 'ft3':           return { value: value * 0.0283168,     siUnit: 'm3' }
    // Area
    case 'm2':            return { value,                        siUnit: 'm2' }
    case 'hectares':      return { value: value * 10000,         siUnit: 'm2' }
    case 'acres':         return { value: value * 4046.86,       siUnit: 'm2' }
    case 'km2':           return { value: value * 1000000,       siUnit: 'm2' }
    case 'ft2':           return { value: value * 0.0929030,     siUnit: 'm2' }
    case 'yd2':           return { value: value * 0.836127,      siUnit: 'm2' }
    // Distance
    case 'km':            return { value,                        siUnit: 'km' }
    case 'miles':         return { value: value * 1.609344,      siUnit: 'km' }
    case 'nautical_miles': return { value: value * 1.852,        siUnit: 'km' }
    case 'm':             return { value: value * 0.001,         siUnit: 'km' }
    // Emissions
    case 'kg_co2e':       return { value,                        siUnit: 'kg_co2e' }
    case 'tonnes_co2e':   return { value: value * 1000,          siUnit: 'kg_co2e' }
    case 'g_co2e':        return { value: value * 0.001,         siUnit: 'kg_co2e' }
    case 'lbs_co2e':      return { value: value * 0.453592,      siUnit: 'kg_co2e' }
    default:              return { value, siUnit: unit as SIDimension }
  }
}

// ── FROM-SI (used at output time, Layer 3) ────────────────────────────────────

export interface ConversionResult {
  originalValue: number
  originalUnit: SIDimension
  convertedValue: number
  convertedUnit: SupportedUnit
  conversionFactor: number
}

export function convertFromSI(
  siValue: number,
  siUnit: SIDimension,
  targetUnit: SupportedUnit,
): ConversionResult {
  const { value: backToSI, siUnit: resolvedSI } = normaliseToSI(1, targetUnit)

  if (resolvedSI !== siUnit) {
    throw new Error(
      `Cannot convert between different dimensions: stored unit '${siUnit}' and requested unit '${targetUnit}' are incompatible`,
    )
  }

  const conversionFactor = 1 / backToSI
  const convertedValue = siValue * conversionFactor

  return {
    originalValue: siValue,
    originalUnit: siUnit,
    convertedValue,
    convertedUnit: targetUnit,
    conversionFactor,
  }
}

export function isSupportedUnit(unit: string): unit is SupportedUnit {
  const supported: SupportedUnit[] = [
    'mj', 'kwh', 'gj', 'btu', 'therms', 'toe', 'kcal',
    'kg', 'tonnes', 'g', 'lbs', 'short_tons', 'long_tons', 'oz',
    'm3', 'litres', 'ml', 'gallons_uk', 'gallons_us', 'barrels', 'ft3',
    'm2', 'hectares', 'acres', 'km2', 'ft2', 'yd2',
    'km', 'miles', 'nautical_miles', 'm',
    'kg_co2e', 'tonnes_co2e', 'g_co2e', 'lbs_co2e',
  ]
  return supported.includes(unit as SupportedUnit)
}
