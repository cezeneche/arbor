// Layer 2 — Emission Factor Application. Pure function — no DB reads, no API calls, no side effects.
// GHG Protocol Corporate Standard Ch.4 — Activity data × emission factor

export interface EmissionFactorInput {
  activityValue: number
  activityUnit: string
  factor: number
  factorUnit: string
  factorSource: string
  factorVersion: string
  citation: string
}

export interface EmissionCalculationResult {
  co2eKg: number
  activityValue: number
  activityUnit: string
  factor: number
  factorUnit: string
  factorSource: string
  factorVersion: string
  citation: string
  calculationExpression: string
}

export function applyEmissionFactor(input: EmissionFactorInput): EmissionCalculationResult {
  const co2eKg = input.activityValue * input.factor
  return {
    co2eKg,
    activityValue: input.activityValue,
    activityUnit: input.activityUnit,
    factor: input.factor,
    factorUnit: input.factorUnit,
    factorSource: input.factorSource,
    factorVersion: input.factorVersion,
    citation: input.citation,
    calculationExpression: `${input.activityValue} ${input.activityUnit} × ${input.factor} ${input.factorUnit} = ${co2eKg.toFixed(4)} kg CO2e`,
  }
}
