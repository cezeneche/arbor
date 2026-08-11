// What a tonnage figure turns a scope answer into.
//
// "Is this in scope?" is answered yes or no. "How much does that mean for me?"
// is the question immediately behind it, and tonnes are what make it answerable
// — CBAM is priced per tonne of embedded CO2e, so mass is the multiplier.
//
// This deliberately stops at tCO2e and does NOT convert to pounds. The
// conversion needs an HMRC-published rate, and where that rate is a placeholder
// rather than a published figure, a pound total would be a made-up number in the
// most quotable position on the screen. Nucleos already refuses to return a
// liability derived from a placeholder rate; showing one here would route around
// that refusal.
//
// The default SEE is the Annex VI world-average value, before the legislated
// mark-up. So this is a floor, not an estimate of the final declarable figure,
// and it says so.

export interface ExposureInput {
  /** Annual import mass, tonnes. */
  tonnes: number
  /** Annex VI world-average default, tCO2e per tonne. */
  defaultSeeTco2ePerT: number
}

export interface Exposure {
  /** Embedded emissions implied by the tonnage, tCO2e. */
  embeddedTco2e: number
  /** How it was arrived at, for the reviewer. */
  basis: string
  /** Why the real figure is higher than this one. */
  qualification: string
}

export function scopeExposure(input: ExposureInput): Exposure | null {
  const { tonnes, defaultSeeTco2ePerT } = input
  if (!Number.isFinite(tonnes) || tonnes <= 0) return null
  if (!Number.isFinite(defaultSeeTco2ePerT) || defaultSeeTco2ePerT <= 0) return null

  const embedded = tonnes * defaultSeeTco2ePerT

  return {
    embeddedTco2e: Math.round(embedded * 100) / 100,
    basis:
      `${tonnes.toLocaleString('en-GB')} t × ${defaultSeeTco2ePerT} tCO₂e/t ` +
      '(EU 2023/1773 Annex VI world-average default)',
    qualification:
      'This is the published default before the legislated mark-up, and before any ' +
      'actual figure from your supplier. A supplier figure is usually lower; the ' +
      'default with its mark-up is higher.',
  }
}
