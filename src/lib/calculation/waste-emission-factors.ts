// Layer 2 — pure function. No DB reads. No API calls. No side effects.
// Emission factors: DEFRA 2024 Greenhouse Gas Reporting: Conversion Factors, Table 8 (Waste disposal)
// Units: tCO2e per tonne of waste

export type WasteDisposalMethod =
  | 'LANDFILL'
  | 'INCINERATION_WITH_RECOVERY'
  | 'INCINERATION_WITHOUT_RECOVERY'
  | 'RECYCLING'
  | 'COMPOSTING'
  | 'TREATMENT'
  | 'OTHER'

// [DEFRA 2024 Table 8] — tCO2e per tonne of waste disposed
export const WASTE_EMISSION_FACTORS: Record<WasteDisposalMethod, number> = {
  LANDFILL: 0.447,                    // [DEFRA 2024 Table 8] mixed waste to landfill
  INCINERATION_WITH_RECOVERY: 0.021,  // [DEFRA 2024 Table 8] energy from waste with recovery
  INCINERATION_WITHOUT_RECOVERY: 0.703, // [DEFRA 2024 Table 8] incineration without energy recovery
  RECYCLING: 0.021,                   // [DEFRA 2024 Table 8] mixed recycling (transport + sorting)
  COMPOSTING: 0.116,                  // [DEFRA 2024 Table 8] composting (food and garden)
  TREATMENT: 0.050,                   // [DEFRA 2024 Table 8] anaerobic digestion / treatment
  OTHER: 0.447,                       // conservative default — same as landfill when method unknown
}

export interface WasteEmissionInput {
  quantity_tonnes: number
  disposalMethod: WasteDisposalMethod
}

export interface WasteEmissionResult {
  co2e_kg: number
  factor_kg_per_tonne: number
  factor_source: string
}

// [DEFRA 2024 Table 8] calculateWasteEmissions — Scope 3 Category 5 (Waste generated in operations)
// [GHG Protocol Scope 3 Standard, Chapter 5]
export function calculateWasteEmissions(input: WasteEmissionInput): WasteEmissionResult {
  const factor_tco2e_per_tonne = WASTE_EMISSION_FACTORS[input.disposalMethod]
  const co2e_kg = input.quantity_tonnes * factor_tco2e_per_tonne * 1000

  return {
    co2e_kg,
    factor_kg_per_tonne: factor_tco2e_per_tonne * 1000,
    factor_source: 'DEFRA 2024 Greenhouse Gas Reporting: Conversion Factors, Table 8',
  }
}
