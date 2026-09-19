// The Resend client and the one HTML-escaping rule every email uses.
//
// The client is created lazily so importing an email module (during
// `next build`, or in a test) never needs RESEND_API_KEY. Null when no key is
// configured: every caller treats email as best-effort.
import { Resend } from 'resend'

let _resend: Resend | null = null

export function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (!_resend) _resend = new Resend(apiKey)
  return _resend
}

/** Escapes a value for interpolation into email HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
