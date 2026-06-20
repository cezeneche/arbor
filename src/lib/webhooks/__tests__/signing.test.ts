import { signWebhookPayload, generateWebhookSecret } from '../signing'

// Gap 6.3 — webhook payloads are signed so subscribers can verify authenticity.
describe('signWebhookPayload', () => {
  it('produces a sha256= prefixed hex signature', () => {
    const sig = signWebhookPayload('secret', '{"event":"record.certified"}')
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('is deterministic for the same secret and payload', () => {
    expect(signWebhookPayload('s', 'p')).toBe(signWebhookPayload('s', 'p'))
  })

  it('differs when the secret differs', () => {
    expect(signWebhookPayload('s1', 'p')).not.toBe(signWebhookPayload('s2', 'p'))
  })

  it('differs when the payload differs', () => {
    expect(signWebhookPayload('s', 'p1')).not.toBe(signWebhookPayload('s', 'p2'))
  })
})

describe('generateWebhookSecret', () => {
  it('generates a high-entropy secret with the whsec_ prefix', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^whsec_[a-f0-9]{48}$/)
  })

  it('generates a unique secret each call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret())
  })
})
