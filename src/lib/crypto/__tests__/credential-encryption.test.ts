import { encryptSecret, decryptSecret } from '../credential-encryption'

// Gap 6/9 — reversible encryption at rest for secrets that must be used later
// (webhook signing secrets, integration credentials). AES-256-GCM.
const ORIGINAL = process.env.INTEGRATION_ENCRYPTION_KEY
beforeAll(() => {
  // 32-byte key, base64-encoded.
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})
afterAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = ORIGINAL
})

describe('credential encryption', () => {
  it('round-trips a secret', () => {
    const plaintext = 'whsec_deadbeef'
    const ct = encryptSecret(plaintext)
    expect(ct).not.toContain(plaintext)
    expect(decryptSecret(ct)).toBe(plaintext)
  })

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('round-trips JSON credential blobs', () => {
    const blob = JSON.stringify({ token: 'abc', refresh: 'xyz' })
    expect(decryptSecret(encryptSecret(blob))).toBe(blob)
  })

  it('fails to decrypt tampered ciphertext', () => {
    const ct = encryptSecret('secret')
    const tampered = ct.slice(0, -2) + (ct.endsWith('aa') ? 'bb' : 'aa')
    expect(() => decryptSecret(tampered)).toThrow()
  })
})
