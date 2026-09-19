import { EMAIL_FROM } from '@/lib/email/config'
import { prisma } from '@/lib/prisma'
import { issueEmailVerification } from './email-verification'
import { escapeHtml, getResend } from '@/lib/email/client'

// Sends the confirm-your-address link. Best-effort: verification is not a
// sign-in gate, so a missing key or a failed send leaves the account working
// and the reminder in the portal offers to send it again.

export async function sendEmailVerification(user: { id: string; email: string; name: string }): Promise<void> {
  const resend = getResend()
  if (!resend) return
  try {
    const { token } = await issueEmailVerification(prisma, user.id)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const url = `${appUrl}/verify-email?token=${token}`
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: user.email,
      subject: 'Confirm your email address for arbor',
      html:
        `<p>Hi ${escapeHtml(user.name)},</p>` +
        `<p>Confirm this is your email address for arbor. The link works for seven days.</p>` +
        `<p><a href="${escapeHtml(url)}">Confirm my email address</a></p>` +
        `<p>If you did not create an arbor account, you can ignore this email.</p>`,
    })
    if (error) console.error('[verify-email] delivery failed:', error)
  } catch (e) {
    console.error('[verify-email] send failed:', e)
  }
}
