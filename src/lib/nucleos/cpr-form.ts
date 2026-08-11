// The derived answers behind a carbon price relief claim. Pure: no DB, no
// network, no calculation of the relief itself — that is Nucleos's engine, and
// duplicating its formula here would produce a second answer that disagrees.
//
// What this does own is the three questions the screen has to answer before the
// engine is called at all: does this origin country run a qualifying scheme,
// what does the relief leave owing, and what is still missing.

/** EU member states, EEA, and Switzerland — the schemes UK CBAM recognises. */
const QUALIFYING: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK',
  'NO', 'IS', 'LI',
  'CH',
])

// Switzerland runs its own scheme. It is linked to the EU's, which is why it
// qualifies at all, but it is a different scheme priced in a different currency
// — claiming under the EU name would misstate the claim.
const NAMED_SCHEMES: Record<string, { schemeName: string; currency: string }> = {
  CH: { schemeName: 'Swiss Emissions Trading Scheme (Swiss ETS)', currency: 'CHF' },
}

const DEFAULT_SCHEME = {
  schemeName: 'EU Emissions Trading System (EU ETS)',
  currency: 'EUR',
}

export interface QualifyingScheme {
  eligible: boolean
  schemeName: string | null
  /** The currency the carbon price is quoted in. */
  currency: string | null
}

export function qualifyingScheme(originCountry: string | null | undefined): QualifyingScheme {
  const iso = (originCountry ?? '').trim().toUpperCase()
  if (!iso || !QUALIFYING.has(iso)) {
    return { eligible: false, schemeName: null, currency: null }
  }
  return { eligible: true, ...(NAMED_SCHEMES[iso] ?? DEFAULT_SCHEME) }
}

/**
 * What is left owing after relief.
 *
 * Floored at zero. Relief reduces a bill; it does not pay one out, and a
 * negative figure on screen reads as money back from HMRC.
 *
 * Null when the liability is not yet known — which is a different statement
 * from zero. Zero says "you owe nothing"; null says "we cannot tell you yet".
 */
export function netLiability(
  liabilityGbp: number | null | undefined,
  reliefGbp: number,
): number | null {
  if (liabilityGbp === null || liabilityGbp === undefined || !Number.isFinite(liabilityGbp)) {
    return null
  }
  return Math.max(0, liabilityGbp - reliefGbp)
}

export interface CprInputs {
  verifiedEmissions: string
  carbonPrice: string
  exchangeRate: string
}

/**
 * Which inputs are not yet usable, named as they appear on screen.
 *
 * A carbon price of zero passes: a scheme whose price settled at zero for the
 * period is a real answer, and rejecting it would block a legitimate nil claim.
 * Emissions and the exchange rate must both be above zero — neither has a
 * meaningful zero, and a zero rate would divide the claim into nothing.
 */
export function missingForCalculation(inputs: CprInputs): string[] {
  const missing: string[] = []
  const positive = (raw: string) => {
    const n = Number(raw)
    return raw.trim() !== '' && Number.isFinite(n) && n > 0
  }
  const nonNegative = (raw: string) => {
    const n = Number(raw)
    return raw.trim() !== '' && Number.isFinite(n) && n >= 0
  }

  if (!positive(inputs.verifiedEmissions)) missing.push('Verified emissions')
  if (!nonNegative(inputs.carbonPrice)) missing.push('Carbon price')
  if (!positive(inputs.exchangeRate)) missing.push('Exchange rate')
  return missing
}
