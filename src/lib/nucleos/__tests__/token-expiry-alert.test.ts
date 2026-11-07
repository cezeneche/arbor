import { sendTokenExpiryAlert, tokenExpiryAlert } from '../token-expiry-alert'
import type { TokenExpiry } from '../service-auth'

function expiry(daysLeft: number | null, expired = false): TokenExpiry {
  return {
    expiresAt: daysLeft === null ? null : '2026-10-05T00:00:00.000Z',
    daysLeft,
    expired,
  }
}

describe('tokenExpiryAlert', () => {
  // A daily cron calls this. Alerting on a few fixed days, rather than every day
  // inside the window, keeps it a reminder instead of noise — until it expires,
  // when every day is worth an alert because every CBAM call is failing.
  it.each([14, 7, 3, 1, 0])('warns with %i day(s) left', days => {
    const alert = tokenExpiryAlert(expiry(days))
    expect(alert).not.toBeNull()
    expect(alert!.severity).toBe('warning')
    expect(alert!.facts).toEqual([{ label: 'Expires on', value: '2026-10-05' }])
    expect(alert!.action).toContain('NUCLEOS_INTERNAL_TOKEN')
  })

  it('says "today" and "in 1 day" in plain words', () => {
    expect(tokenExpiryAlert(expiry(0))!.title).toBe('The Nucleos service token expires today')
    expect(tokenExpiryAlert(expiry(1))!.title).toBe('The Nucleos service token expires in 1 day')
  })

  it.each([30, 13, 8, 5, 2])('stays quiet with %i days left', days => {
    expect(tokenExpiryAlert(expiry(days))).toBeNull()
  })

  it('is critical every day once the token has expired, and says CBAM is down', () => {
    const alert = tokenExpiryAlert(expiry(-3, true))
    expect(alert!.severity).toBe('critical')
    expect(alert!.title).toMatch(/expired/i)
    expect(alert!.summary).toMatch(/every CBAM/i)
  })

  it('stays quiet for a token that never expires', () => {
    expect(tokenExpiryAlert(expiry(null))).toBeNull()
  })
})

describe('sendTokenExpiryAlert', () => {
  const quietSlack = {
    webhooks: { ops: undefined, enquiries: undefined },
    fetchImpl: jest.fn() as unknown as typeof fetch,
  }

  // Expected: Slack and every platform admin by email. Reason: a warning is
  // something someone must act on.
  it('emails every platform admin when an alert is due', async () => {
    const sendEmail = jest.fn().mockResolvedValue(undefined)
    const result = await sendTokenExpiryAlert(expiry(7), {
      ...quietSlack,
      recipients: async () => ['ops@example.com', 'owner@example.com'],
      sendEmail,
    })
    expect(result).toEqual({ sent: 2 })
    expect(sendEmail.mock.calls.map(c => c[0].to)).toEqual(['ops@example.com', 'owner@example.com'])
    expect(sendEmail.mock.calls[0][0].subject).toBe(
      '[Arbor development] Warning: The Nucleos service token expires in 7 days',
    )
  })

  it('does not look up recipients when no alert is due', async () => {
    const recipients = jest.fn()
    const result = await sendTokenExpiryAlert(expiry(20), { ...quietSlack, recipients, sendEmail: jest.fn() })
    expect(result).toEqual({ sent: 0 })
    expect(recipients).not.toHaveBeenCalled()
  })

  it('never throws: a failed send is counted, not raised', async () => {
    const sendEmail = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(undefined)
    const result = await sendTokenExpiryAlert(expiry(0), {
      ...quietSlack,
      recipients: async () => ['a@example.com', 'b@example.com'],
      sendEmail,
    })
    expect(result).toEqual({ sent: 1 })
  })
})
