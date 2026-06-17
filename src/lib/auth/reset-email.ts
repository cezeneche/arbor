import { Resend } from 'resend'

// Lazily instantiated so importing this module (e.g. during `next build`) never
// requires RESEND_API_KEY. Mirrors the pattern in src/lib/notifications.ts.
let _resend: Resend | null = null
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (!_resend) _resend = new Resend(apiKey)
  return _resend
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Sends the password reset link. Delivery is best-effort: a missing API key or a
 * send failure is swallowed so the caller's response stays constant regardless of
 * whether the email account exists (avoids account enumeration).
 */
export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(resetUrl)
  const html =
    `<p>Hi ${safeName},</p>` +
    `<p>We received a request to reset your arbor password. ` +
    `Click the link below to choose a new one. This link expires in one hour.</p>` +
    `<p><a href="${safeUrl}">Reset your password</a></p>` +
    `<p>If you didn't ask to reset your password, you can ignore this email — your password won't change.</p>`

  try {
    await resend.emails.send({
      from: 'arbor <onboarding@resend.dev>',
      to,
      subject: 'Reset your arbor password',
      html,
    })
  } catch {
    // Non-fatal: never surface delivery errors to the caller.
  }
}
