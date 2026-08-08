// Pure rules for what a certificate's expiry date means. No DB, no AI, no clock
// of its own — `today` is always passed in, so the job is deterministic and
// testable.
//
// Two things were wrong with deciding this inline. A field was only examined
// while flagged=false, so the 30-day warning set the flag and then permanently
// excluded the field: a certificate warned about in March was never re-examined
// in April and never became "expired". And the expiry was recorded against the
// extracted field only, so records certified from an expired certificate carried
// no visible sign of it while still reading Verified.

export type CertificateExpiryState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'UNREADABLE'

export const EXPIRY_WARNING_DAYS = 30

export function daysUntil(date: Date, from: Date): number {
  return Math.ceil((date.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

export function classifyCertificateExpiry(
  rawValue: string | null,
  today: Date,
  warningDays = EXPIRY_WARNING_DAYS,
): { state: CertificateExpiryState; expiryDate: Date | null } {
  if (!rawValue) return { state: 'UNREADABLE', expiryDate: null }

  const expiryDate = new Date(rawValue)
  if (Number.isNaN(expiryDate.getTime())) return { state: 'UNREADABLE', expiryDate: null }

  if (expiryDate.getTime() < today.getTime()) return { state: 'EXPIRED', expiryDate }

  const threshold = new Date(today)
  threshold.setDate(threshold.getDate() + warningDays)
  if (expiryDate.getTime() < threshold.getTime()) return { state: 'EXPIRING', expiryDate }

  return { state: 'VALID', expiryDate }
}

/** The stored flagReason for a state, used both to write the flag and to tell
 *  whether the field has already been flagged for THIS state — which is what
 *  lets an EXPIRING field later become EXPIRED instead of being skipped. */
export function certificateFlagReason(
  state: CertificateExpiryState,
  rawValue: string,
  daysRemaining?: number,
): string | null {
  switch (state) {
    case 'EXPIRED':
      return `Certificate expired ${rawValue}. Document is no longer valid for the current reporting period.`
    case 'EXPIRING':
      return `Certificate expires ${rawValue}. Within ${daysRemaining ?? EXPIRY_WARNING_DAYS} days. Renew before reporting period end.`
    default:
      return null
  }
}

/** A record is compromised by an expired certificate when the period it reports on
 *  is not fully covered by that certificate — i.e. the certificate lapsed before
 *  the period ended (admissibility spec §8.1).
 *
 *  A certificate that expired *after* the reporting period is not a problem for
 *  that record: the record was true for the period it covers, and the chain is
 *  append-only, so nothing about it is rewritten. What it earns is a visible flag,
 *  not a silent tier change. */
export function certificateCoversPeriod(expiryDate: Date, periodEnd: Date): boolean {
  return expiryDate.getTime() >= periodEnd.getTime()
}

export function expiredCertificateFlagMessage(expiryRawValue: string, periodEnd: Date): string {
  return `The certificate behind this figure expired on ${expiryRawValue}, before the end of the period it covers (${periodEnd.toISOString().slice(0, 10)}). Upload a current certificate to restore this record's standing.`
}
