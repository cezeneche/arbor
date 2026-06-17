import {
  generateTotpSecret,
  verifyTotpCode,
  getTotpUri,
  encryptTotpSecret,
  decryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '../totp'

// Provide a valid 64-char hex TOTP_ENCRYPTION_KEY for tests
const TEST_KEY = 'a'.repeat(64)
beforeAll(() => {
  process.env.TOTP_ENCRYPTION_KEY = TEST_KEY
})

describe('generateTotpSecret', () => {
  it('returns a non-empty base32 string', () => {
    const secret = generateTotpSecret()
    expect(typeof secret).toBe('string')
    expect(secret.length).toBeGreaterThanOrEqual(16)
    // base32 charset: A-Z and 2-7
    expect(secret).toMatch(/^[A-Z2-7]+=*$/)
  })

  it('returns a different secret on each call', () => {
    const a = generateTotpSecret()
    const b = generateTotpSecret()
    expect(a).not.toBe(b)
  })
})

describe('verifyTotpCode', () => {
  it('returns false for an obviously wrong code', () => {
    const secret = generateTotpSecret()
    expect(verifyTotpCode(secret, '000000')).toBe(false)
  })

  it('returns false for a non-numeric code', () => {
    const secret = generateTotpSecret()
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false)
  })
})

describe('getTotpUri', () => {
  it('returns an otpauth:// URI containing the email and issuer', () => {
    const secret = generateTotpSecret()
    const uri = getTotpUri(secret, 'test@example.com', 'Arbor')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('Arbor')
    expect(uri).toContain('test%40example.com')
  })
})

describe('encryptTotpSecret / decryptTotpSecret', () => {
  it('round-trips a TOTP secret', () => {
    const secret = generateTotpSecret()
    const encrypted = encryptTotpSecret(secret)
    expect(decryptTotpSecret(encrypted)).toBe(secret)
  })

  it('produces different ciphertext for the same input (random IV)', () => {
    const secret = generateTotpSecret()
    const enc1 = encryptTotpSecret(secret)
    const enc2 = encryptTotpSecret(secret)
    expect(enc1).not.toBe(enc2)
  })

  it('encrypted string has three colon-separated segments', () => {
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP')
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)
    // iv, authTag, ciphertext — all non-empty
    parts.forEach(p => expect(p.length).toBeGreaterThan(0))
  })

  it('throws when the auth tag is tampered', () => {
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP')
    const [iv, tag, data] = encrypted.split(':')
    // Corrupt the auth tag — GCM will reject it
    const badTag = tag.slice(0, -2) + (tag.endsWith('AA') ? 'BB' : 'AA')
    const tampered = `${iv}:${badTag}:${data}`
    expect(() => decryptTotpSecret(tampered)).toThrow()
  })

  it('throws when the format is invalid', () => {
    expect(() => decryptTotpSecret('not-valid')).toThrow()
  })
})

describe('generateRecoveryCodes', () => {
  it('returns exactly 10 codes', () => {
    expect(generateRecoveryCodes()).toHaveLength(10)
  })

  it('each code matches the xxxx-xxxx hex pattern', () => {
    const codes = generateRecoveryCodes()
    codes.forEach(code => {
      expect(code).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/)
    })
  })

  it('all codes are unique', () => {
    const codes = generateRecoveryCodes()
    expect(new Set(codes).size).toBe(10)
  })
})

describe('hashRecoveryCode', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashRecoveryCode('abcd1234-efgh5678')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const code = 'abcd1234-efgh5678'
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code))
  })

  it('produces different hashes for different codes', () => {
    expect(hashRecoveryCode('aaaa0000-bbbb1111')).not.toBe(hashRecoveryCode('cccc2222-dddd3333'))
  })
})

describe('verifyRecoveryCode', () => {
  it('returns true when the code matches the stored hash', () => {
    const code = 'abcd1234-efgh5678'
    const hash = hashRecoveryCode(code)
    expect(verifyRecoveryCode(hash, code)).toBe(true)
  })

  it('returns false when the code does not match', () => {
    const hash = hashRecoveryCode('correct-code-xxxx')
    expect(verifyRecoveryCode(hash, 'wrong-code-xxxxx')).toBe(false)
  })

  it('is case-insensitive', () => {
    const code = 'ABCD1234-EFGH5678'
    const hash = hashRecoveryCode(code)
    expect(verifyRecoveryCode(hash, code.toLowerCase())).toBe(true)
  })
})
