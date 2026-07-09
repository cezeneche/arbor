import { generateOpaqueToken, hashOpaqueToken } from '@/lib/tokens/opaque-token'

describe('opaque-token', () => {
  it('generates a high-entropy, URL-safe token each time', () => {
    const a = generateOpaqueToken()
    const b = generateOpaqueToken()
    expect(a).not.toEqual(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no +/=
    expect(a.length).toBeGreaterThanOrEqual(43) // 32 bytes base64url
  })

  it('hash is deterministic and 64 hex chars (SHA-256)', () => {
    const t = generateOpaqueToken()
    expect(hashOpaqueToken(t)).toEqual(hashOpaqueToken(t))
    expect(hashOpaqueToken(t)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different tokens hash differently', () => {
    expect(hashOpaqueToken('a')).not.toEqual(hashOpaqueToken('b'))
  })
})
