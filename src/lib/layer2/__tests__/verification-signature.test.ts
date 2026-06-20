import { computeVerificationSignature, computePackageHash } from '../verification-signature'

// Gap 3/4 — cryptographic signing of verification artefacts and audit packages.
// Deterministic HMAC over a stable serialisation; secret never leaves the server.

const ORIGINAL_SECRET = process.env.AUDIT_CHAIN_SECRET
beforeAll(() => {
  process.env.AUDIT_CHAIN_SECRET = 'test-secret-key-for-verification'
})
afterAll(() => {
  process.env.AUDIT_CHAIN_SECRET = ORIGINAL_SECRET
})

describe('computeVerificationSignature', () => {
  const input = {
    entityId: 'ent_1',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-03-31T00:00:00.000Z',
    verifierId: 'usr_v',
    verifiedAt: '2026-06-19T10:00:00.000Z',
  }

  it('is deterministic for identical inputs', () => {
    expect(computeVerificationSignature(input)).toBe(computeVerificationSignature(input))
  })

  it('returns a 64-char hex digest', () => {
    expect(computeVerificationSignature(input)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when any field changes', () => {
    const base = computeVerificationSignature(input)
    expect(computeVerificationSignature({ ...input, verifierId: 'usr_other' })).not.toBe(base)
    expect(computeVerificationSignature({ ...input, entityId: 'ent_2' })).not.toBe(base)
  })
})

describe('computePackageHash', () => {
  it('is deterministic and stable regardless of key order', () => {
    const a = computePackageHash({ entityId: 'e', records: [1, 2], meta: 'x' })
    const b = computePackageHash({ meta: 'x', records: [1, 2], entityId: 'e' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when contents change', () => {
    const a = computePackageHash({ n: 1 })
    const b = computePackageHash({ n: 2 })
    expect(a).not.toBe(b)
  })
})
