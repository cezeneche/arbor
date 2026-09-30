// The derived answers behind a carbon price relief claim. Pure: no DB, no
// network, no calculation of the relief itself — that is Nucleos's engine, and
// duplicating its formula here would produce a second answer that disagrees.
//
// What this does own is the question the screen has to answer before the
// engine is called at all: what is still missing. Which schemes qualify, and in which currency, is Nucleos's reference
// data (relief-client, relief-presenter) — Arbor's own copy had drifted.

export interface CprInputs {
  verifiedEmissions: string
  carbonPrice: string
  /** ISO 4217, the currency the carbon price was paid in. */
  currency: string
  exchangeRate: string
  /** YYYY-MM-DD: the date the exchange rate applies to, normally the import date. */
  rateDate: string
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

  const isDate = (raw: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())

  if (!positive(inputs.verifiedEmissions)) missing.push('Verified emissions')
  if (!nonNegative(inputs.carbonPrice)) missing.push('Carbon price')
  if (!/^[A-Z]{3}$/.test(inputs.currency.trim())) missing.push('Currency')
  if (!positive(inputs.exchangeRate)) missing.push('Exchange rate')
  if (!isDate(inputs.rateDate.trim())) missing.push('Date of the exchange rate')
  return missing
}
