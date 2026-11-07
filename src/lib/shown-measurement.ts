// The value and unit a supplier sees for one of their records, and types a
// correction in: as they entered or uploaded it, or the stored SI form for a
// record written before originals were kept. Shared by Review's list and the
// correction itself, so the two cannot disagree about the unit.
export function shownMeasurement(r: {
  value: number
  unit: string
  originalValue: number | null
  originalUnit: string | null
}): { value: number; unit: string } {
  return r.originalValue !== null && r.originalUnit !== null
    ? { value: r.originalValue, unit: r.originalUnit }
    : { value: r.value, unit: r.unit }
}
