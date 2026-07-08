import { createHmac } from 'crypto'
import {
  verifyBodyHmac,
  verifyWorkosSignature,
  parseWorkosSignatureHeader,
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
