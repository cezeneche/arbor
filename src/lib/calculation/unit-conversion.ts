// Layer 2 — Unit Conversion. Pure functions only — no DB reads, no API calls, no side effects.
// GHG Protocol Scope 3 Standard Ch.7 — unit consistency requirement
// DEFRA Conversion Factors 2024 — UK reporting basis

export function kwhToMj(kwh: number): number {
  return kwh * 3.6 // 1 kWh = 3.6 MJ (exact, SI definition)
}

export function thermsToMj(therms: number): number {
  return therms * 105.505585 // 1 therm (UK) = 105.505585 MJ
}

export function tonnesToKg(tonnes: number): number {
  return tonnes * 1000 // 1 tonne = 1000 kg (exact)
}

export function shortTonsToKg(shortTons: number): number {
  return shortTons * 907.18474 // 1 short ton (US) = 907.18474 kg
}

export function litresToM3(litres: number): number {
  return litres * 0.001 // 1 litre = 0.001 m³ (exact)
}

export function hectaresToM2(hectares: number): number {
  return hectares * 10000 // 1 hectare = 10,000 m² (exact)
}

export function milesToKm(miles: number): number {
  return miles * 1.609344 // 1 mile = 1.609344 km (exact, international definition)
}

export type SupportedUnit =
  | 'kwh' | 'mj' | 'gj' | 'therms' | 'toe'
  | 'kg' | 'tonnes' | 'short_tons' | 'lbs'
  | 'litres' | 'm3' | 'gallons_uk' | 'gallons_us'
  | 'm2' | 'hectares' | 'acres'
  | 'km' | 'miles' | 'nautical_miles'
  | 'kg_co2e' | 'tonnes_co2e'

export function normaliseToSI(value: number, unit: SupportedUnit): { value: number; siUnit: string } {
  switch (unit) {
    case 'kwh':           return { value: kwhToMj(value), siUnit: 'mj' }
    case 'mj':            return { value, siUnit: 'mj' }
    case 'gj':            return { value: value * 1000, siUnit: 'mj' }
    case 'therms':        return { value: thermsToMj(value), siUnit: 'mj' }
    case 'toe':           return { value: value * 41868, siUnit: 'mj' }
    case 'kg':            return { value, siUnit: 'kg' }
    case 'tonnes':        return { value: tonnesToKg(value), siUnit: 'kg' }
    case 'short_tons':    return { value: shortTonsToKg(value), siUnit: 'kg' }
    case 'lbs':           return { value: value * 0.453592, siUnit: 'kg' }
    case 'litres':        return { value: litresToM3(value), siUnit: 'm3' }
    case 'm3':            return { value, siUnit: 'm3' }
    case 'gallons_uk':    return { value: value * 0.00454609, siUnit: 'm3' }
    case 'gallons_us':    return { value: value * 0.00378541, siUnit: 'm3' }
    case 'm2':            return { value, siUnit: 'm2' }
    case 'hectares':      return { value: hectaresToM2(value), siUnit: 'm2' }
    case 'acres':         return { value: value * 4046.86, siUnit: 'm2' }
    case 'km':            return { value, siUnit: 'km' }
    case 'miles':         return { value: milesToKm(value), siUnit: 'km' }
    case 'nautical_miles': return { value: value * 1.852, siUnit: 'km' }
    case 'kg_co2e':       return { value, siUnit: 'kg_co2e' }
    case 'tonnes_co2e':   return { value: value * 1000, siUnit: 'kg_co2e' }
    default:              return { value, siUnit: unit }
  }
}
