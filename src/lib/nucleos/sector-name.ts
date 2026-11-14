// CBAM sector codes as a person reads them. Nucleos's codes (cbam_taric.py)
// are identifiers, and "iron_steel" on screen reads as a code, not a sector.
const NAMES: Record<string, string> = {
  iron_steel: 'Iron and steel',
  aluminium: 'Aluminium',
  cement: 'Cement',
  fertilisers: 'Fertilisers',
  hydrogen: 'Hydrogen',
  electricity: 'Electricity',
}

/** "iron_steel" → "Iron and steel". An unknown code is de-underscored, never hidden. */
export function sectorName(code: string): string {
  const known = NAMES[code.trim().toLowerCase()]
  if (known) return known
  const words = code.trim().replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The same name inside a sentence: "iron and steel". */
export function sectorNameInText(code: string): string {
  const name = sectorName(code)
  return name.charAt(0).toLowerCase() + name.slice(1)
}
