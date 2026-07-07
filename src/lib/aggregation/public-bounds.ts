// public clamp bounds for differentially-private benchmarks.
//
// The Laplace mechanism's sensitivity depends on a value range that must come
// from *public* domain knowledge, never from the data (deriving bounds from the
// data would itself leak). Only fields with a defined, tight public range are
// eligible for DP release; everything else is skipped (raw totals need
// domain-specific per-entity caps — a noted follow-up).

export const PUBLIC_BOUNDS: Record<string, [number, number]> = {
  // Embedded emissions intensity (tCO2e per tonne) — the headline benchmark.
  embedded_emissions_per_tonne: [0, 30],
  // Fertiliser nutrient content is a percentage by definition.
  nitrogen_content_percent: [0, 100],
  phosphorus_content_percent: [0, 100],
  potassium_content_percent: [0, 100],
}

export function boundsFor(fieldName: string): [number, number] | null {
  return PUBLIC_BOUNDS[fieldName] ?? null
}
