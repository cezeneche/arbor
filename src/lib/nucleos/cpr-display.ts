// How a carbon price relief claim is presented.
//
// The verification flag is NON-BLOCKING but it must travel. An unverified claim
// is still payable and still reduces the liability, so refusing to show it would
// be wrong — but presenting it as though it were verified would be worse.
//
// Arbor's design rules already forbid confident styling on uncertain data. This
// applies that rule to a signal that is not a confidence score: verification is
// binary and external, not a probability, so it cannot go through trustDisplay.
// It sits alongside it, using the same visual vocabulary.

import type { TrustBand } from '@/lib/confidence/trust-display'

export type CprVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE'

export interface CprClaimInput {
  reliefAmount: number
  reliefCurrency: string
  verificationStatus: CprVerificationStatus
  capped: boolean
  uncappedAmount?: number | null
  exchangeRate?: number | null
  exchangeRateDate?: string | null
  schemeQualifying?: boolean | null
  scheme?: string | null
}

export interface CprDisplay {
  /** The amount, formatted. Always shown — the claim is payable either way. */
  amount: string
  /** Reuses the trust vocabulary so unverified relief reads like uncertain data. */
  band: TrustBand
  /** True when the UI must break its scanning pattern for this claim. */
  breaksPattern: boolean
  /** Plain-English status line. */
  summary: string
  /** Everything a reviewer needs to judge the claim, in order. */
  qualifications: string[]
}

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }

function formatAmount(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  const formatted = amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`
}

export function cprDisplay(claim: CprClaimInput): CprDisplay {
  const qualifications: string[] = []

  // Order matters: the reason a figure might be wrong comes before the detail of
  // how it was derived, because a reviewer scanning stops at the first line.
  if (claim.verificationStatus === 'UNVERIFIED') {
    qualifications.push(
      'The carbon price behind this claim has not been verified. The relief still applies.',
    )
  }
  if (claim.schemeQualifying === false) {
    qualifications.push(
      `${claim.scheme ?? 'This scheme'} is not on the qualifying list for this jurisdiction.`,
    )
  }
  if (claim.capped) {
    const uncapped =
      typeof claim.uncappedAmount === 'number'
        ? ` Claimed ${formatAmount(claim.uncappedAmount, claim.reliefCurrency)}.`
        : ''
    qualifications.push(
      `Capped at the CBAM liability — relief never exceeds the charge it offsets.${uncapped}`,
    )
  }
  if (claim.exchangeRate && claim.exchangeRateDate) {
    qualifications.push(
      `Converted at ${claim.exchangeRate} on ${claim.exchangeRateDate}.`,
    )
  }

  const band: TrustBand =
    claim.verificationStatus === 'VERIFIED'
      ? 'high'
      : claim.verificationStatus === 'UNVERIFIED'
        ? 'low'
        : 'moderate'

  const summary =
    claim.verificationStatus === 'VERIFIED'
      ? 'Verified carbon price'
      : claim.verificationStatus === 'UNVERIFIED'
        ? 'Unverified carbon price — please review'
        : 'Verification not applicable'

  return {
    amount: formatAmount(claim.reliefAmount, claim.reliefCurrency),
    band,
    // An unverified claim must not scan like a verified one. This is the same
    // rule the confidence display applies to a low-confidence field.
    breaksPattern: claim.verificationStatus === 'UNVERIFIED' || claim.schemeQualifying === false,
    summary,
    qualifications,
  }
}
