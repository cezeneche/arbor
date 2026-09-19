// Layer 2 — the unit a record is stored in. Pure.
//
// Every record is stored in its dimension's SI unit, whichever path wrote it.
// The conversion API converts from SI on output and every aggregate adds stored
// values together, so a record stored as "100 kwh" beside one stored as
// "360 mj" is two figures that silently cannot be summed. The original value
// and unit are kept on the record beside the canonical ones.
import { isSupportedUnit, normaliseToSI, type SupportedUnit } from '@/lib/layer3/unit-conversion'

// Spellings that turn up on real documents and in API payloads.
const ALIASES: Record<string, SupportedUnit> = {
  't': 'tonnes',
  'tonne': 'tonnes',
  'mt': 'tonnes',
  'kgs': 'kg',
  'kilograms': 'kg',
  'cu.m': 'm3',
  'cu m': 'm3',
  'm³': 'm3',
  'l': 'litres',
  'liters': 'litres',
  'liter': 'litres',
  'litre': 'litres',
  'tco2e': 'tonnes_co2e',
  'kgco2e': 'kg_co2e',
  'lb': 'lbs',
}

// Figures with no physical dimension. Stored as given; nothing converts them.
const UNITLESS: Record<string, string> = {
  'unknown': 'unknown',
  'count': 'count',
  'units': 'count',
  'unit': 'count',
  'percent': 'percent',
  '%': 'percent',
}

export type ResolvedUnit =
  | { kind: 'measured'; unit: SupportedUnit }
  | { kind: 'unitless'; unit: string }

export class UnsupportedUnitError extends Error {
  constructor(readonly unit: string) {
    super(`Arbor does not recognise the unit "${unit}", so the figure could not be stored in a form every total can use.`)
    this.name = 'UnsupportedUnitError'
  }
}

export function resolveUnit(raw: string): ResolvedUnit | null {
  const key = raw.trim().toLowerCase()
  if (!key) return null
  if (isSupportedUnit(key)) return { kind: 'measured', unit: key }
  const alias = ALIASES[key]
  if (alias) return { kind: 'measured', unit: alias }
  const unitless = UNITLESS[key]
  if (unitless) return { kind: 'unitless', unit: unitless }
  return null
}

/** The value and unit a record is stored under. Throws for a unit it cannot convert. */
export function canonicaliseMeasurement(value: number, unit: string): { value: number; unit: string } {
  const resolved = resolveUnit(unit)
  if (!resolved) throw new UnsupportedUnitError(unit)
  if (resolved.kind === 'unitless') return { value, unit: resolved.unit }
  const { value: si, siUnit } = normaliseToSI(value, resolved.unit)
  return { value: si, unit: siUnit }
}

/** Whether a unit can be stored. For validating input before a write begins. */
export function isStorableUnit(unit: string): boolean {
  return resolveUnit(unit) !== null
}
