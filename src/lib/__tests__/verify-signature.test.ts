import { createHmac } from 'crypto'
import {
  verifyBodyHmac,
  verifyWorkosSignature,
  parseWorkosSignatureHeader,
  verifyTimestampedBodyHmac,
} from '@/lib/webhooks/verify-signature'

const SECRET = 'test-webhook-secret'

function bodyHmac(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}
function workosSig(body: string, t: number): string {
  return createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
}

describe('verifyBodyHmac', () => {
  const body = '{"event":"x"}'
  it('accepts a correct signature', () => {
    expect(verifyBodyHmac(body, bodyHmac(body), SECRET)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifyBodyHmac('{"event":"y"}', bodyHmac(body), SECRET)).toBe(false)
  })
  it('rejects a missing signature', () => {
    expect(verifyBodyHmac(body, null, SECRET)).toBe(false)
  })
  it('rejects the wrong secret', () => {
    const other = createHmac('sha256', 'nope').update(body).digest('hex')
    expect(verifyBodyHmac(body, other, SECRET)).toBe(false)
  })
})

describe('verifyWorkosSignature', () => {
  const body = '{"event":"user.deactivated"}'
  const now = new Date('2026-07-07T12:00:00Z')
  // WorkOS signs with a millisecond epoch timestamp (Date.now()).
  const t = now.getTime()

  it('accepts a valid, in-tolerance signature', () => {
    const header = `t=${t}, v1=${workosSig(body, t)}`
    expect(verifyWorkosSignature(body, header, SECRET, { now })).toBe(true)
  })
  it('rejects a replayed (stale timestamp) delivery', () => {
    const old = t - 10_000_000 // ~2.8h in ms, well past the 300s window
    const header = `t=${old}, v1=${workosSig(body, old)}`
    expect(verifyWorkosSignature(body, header, SECRET, { now, toleranceSec: 300 })).toBe(false)
  })
  it('rejects a tampered body', () => {
    const header = `t=${t}, v1=${workosSig(body, t)}`
    expect(verifyWorkosSignature('{"event":"other"}', header, SECRET, { now })).toBe(false)
  })
  it('rejects a malformed header', () => {
    expect(verifyWorkosSignature(body, 'garbage', SECRET, { now })).toBe(false)
    expect(parseWorkosSignatureHeader(null)).toEqual({ timestamp: null, signature: null })
  })
})

describe('verifyTimestampedBodyHmac', () => {
  const body = '{"to":"upload-abc@arbor.io"}'
  const NOW = new Date('2026-08-08T12:00:00Z')
  const nowSec = Math.floor(NOW.getTime() / 1000)
  const sign = (b: string, t: number) =>
    createHmac('sha256', SECRET).update(`${t}.${b}`).digest('hex')

  it('accepts a fresh, correctly signed delivery', () => {
    expect(
      verifyTimestampedBodyHmac(body, String(nowSec), sign(body, nowSec), SECRET, { now: NOW }),
    ).toBe(true)
  })

  // The defect: a body-only HMAC stays valid for ever, so one captured delivery
  // could be replayed indefinitely.
  it('rejects a delivery older than the tolerance', () => {
    const old = nowSec - 3600
    expect(
      verifyTimestampedBodyHmac(body, String(old), sign(body, old), SECRET, { now: NOW }),
    ).toBe(false)
  })

  it('rejects a delivery timestamped in the future beyond the tolerance', () => {
    const ahead = nowSec + 3600
    expect(
      verifyTimestampedBodyHmac(body, String(ahead), sign(body, ahead), SECRET, { now: NOW }),
    ).toBe(false)
  })

  // Moving the timestamp to make an old capture look fresh breaks the signature,
  // because the timestamp is inside the signed material.
  it('rejects a replay whose timestamp was moved forward', () => {
    const old = nowSec - 3600
    expect(
      verifyTimestampedBodyHmac(body, String(nowSec), sign(body, old), SECRET, { now: NOW }),
    ).toBe(false)
  })

  it('rejects a tampered body', () => {
    expect(
      verifyTimestampedBodyHmac('{"to":"other"}', String(nowSec), sign(body, nowSec), SECRET, { now: NOW }),
    ).toBe(false)
  })

  it('rejects a missing or unparseable timestamp', () => {
    expect(verifyTimestampedBodyHmac(body, null, sign(body, nowSec), SECRET, { now: NOW })).toBe(false)
    expect(verifyTimestampedBodyHmac(body, 'yesterday', sign(body, nowSec), SECRET, { now: NOW })).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(verifyTimestampedBodyHmac(body, String(nowSec), null, SECRET, { now: NOW })).toBe(false)
  })
})
