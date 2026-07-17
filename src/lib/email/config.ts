// Central email configuration.
//
// EMAIL_FROM: the transactional from-address. Defaults to Resend's sandbox
// sender, which ONLY delivers to the Resend account owner's own email — fine for
// local dev, useless for real customers. Set EMAIL_FROM to a verified-domain
// address (e.g. "arbor <notifications@yourdomain.com>") before onboarding anyone.
//
// INBOUND_EMAIL_DOMAIN: the domain customers email documents/requests to
// (upload-<token>@<domain>, requests-<token>@<domain>). Unset until MX records
// and the provider webhook are wired — while unset, the portal hides these
// addresses entirely so no customer is ever shown an address that bounces.

export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'arbor <onboarding@resend.dev>'

export function inboundEmailDomain(): string | null {
  const d = process.env.INBOUND_EMAIL_DOMAIN?.trim()
  return d ? d : null
}

/** upload-<token>@<domain>, or null when inbound email is not yet enabled. */
export function uploadAddress(token: string | null | undefined): string | null {
  const domain = inboundEmailDomain()
  return domain && token ? `upload-${token}@${domain}` : null
}

/** requests-<token>@<domain>, or null when inbound email is not yet enabled. */
export function requestsAddress(token: string | null | undefined): string | null {
  const domain = inboundEmailDomain()
  return domain && token ? `requests-${token}@${domain}` : null
}
