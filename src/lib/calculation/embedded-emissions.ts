// Layer 2 — Embedded Emissions Calculation. Pure function — no DB reads, no API calls, no side effects.
// EU Regulation 2023/1773 Art. 4(1)(2) — total and specific embedded emissions
// GHG Protocol Product Standard — product-level embedded emissions methodology

export interface EmbeddedEmissionsInput {
  directEmissionsKgCo2e: number
  indirectEmissionsKgCo2e: number
  productMassKg: number
  tier: 1 | 2 | 3
}

export interface EmbeddedEmissionsResult {
  totalEmbeddedEmissionsKgCo2e: number
  embeddedEmissionsPerTonneKgCo2e: number
  directEmissionsKgCo2e: number
  indirectEmissionsKgCo2e: number
  productMassKg: number
  tier: 1 | 2 | 3
  citation: string
}

export function calculateEmbeddedEmissions(input: EmbeddedEmissionsInput): EmbeddedEmissionsResult {
  if (input.productMassKg <= 0) throw new Error('Product mass must be greater than zero')
  if (input.directEmissionsKgCo2e < 0) throw new Error('Direct emissions cannot be negative')
  if (input.indirectEmissionsKgCo2e < 0) throw new Error('Indirect emissions cannot be negative')

  // EU 2023/1773 Art. 4(1) — total embedded = direct + indirect
  const total = input.directEmissionsKgCo2e + input.indirectEmissionsKgCo2e

  // EU 2023/1773 Art. 4(2) — specific embedded = total / mass × 1000 (per tonne)
  const perTonne = (total / input.productMassKg) * 1000

  return {
    totalEmbeddedEmissionsKgCo2e: total,
    embeddedEmissionsPerTonneKgCo2e: perTonne,
    directEmissionsKgCo2e: input.directEmissionsKgCo2e,
    indirectEmissionsKgCo2e: input.indirectEmissionsKgCo2e,
    productMassKg: input.productMassKg,
    tier: input.tier,
    citation:
      'EU Regulation 2023/1773 Art. 4(1)(2) — Specific embedded emissions per tonne of product',
  }
}
