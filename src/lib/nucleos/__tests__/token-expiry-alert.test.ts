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
  // when every day is worth an email because every CBAM call is failing.
  it.each([14, 7, 3, 1, 0])('alerts with %i day(s) left', days => {
    const alert = tokenExpiryAlert(expiry(days))
    expect(alert).not.toBeNull()
    expect(alert!.text).toContain('2026-10-05')
    expect(alert!.text).toContain('NUCLEOS_INTERNAL_TOKEN')
  })

  it.each([30, 13, 8, 5, 2])('stays quiet with %i days left', days => {
    expect(tokenExpiryAlert(expiry(days))).toBeNull()
  })

  it('alerts every day once the token has expired, and says CBAM is down', () => {
    const alert = tokenExpiryAlert(expiry(-3, true))
    expect(alert).not.toBeNull()
    expect(alert!.subject).toMatch(/expired/i)
    expect(alert!.text).toMatch(/every CBAM/i)
  })

  it('stays quiet for a token that never expires', () => {
    expect(tokenExpiryAlert(expiry(null))).toBeNull()
  })
})

describe('sendTokenExpiryAlert', () => {
  it('emails every platform admin when an alert is due', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    const result = await sendTokenExpiryAlert(expiry(7), {
      recipients: async () => ['ops@example.com', 'owner@example.com'],
      send,
    })
    expect(result).toEqual({ sent: 2 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(c => c[0].to)).toEqual(['ops@example.com', 'owner@example.com'])
  })

  it('does not look up recipients when no alert is due', async () => {
    const recipients = jest.fn()
    const result = await sendTokenExpiryAlert(expiry(20), { recipients, send: jest.fn() })
    expect(result).toEqual({ sent: 0 })
    expect(recipients).not.toHaveBeenCalled()
  })

  it('says so when an alert is due but there is nobody to send it to', async () => {
    const result = await sendTokenExpiryAlert(expiry(1), { recipients: async () => [], send: jest.fn() })
    expect(result).toEqual({ sent: 0, reason: 'no-platform-admins' })
  })

  it('never throws: a failed send is counted, not raised', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(undefined)
    const result = await sendTokenExpiryAlert(expiry(0), {
      recipients: async () => ['a@example.com', 'b@example.com'],
      send,
    })
    expect(result).toEqual({ sent: 1, failed: 1 })
  })
})
