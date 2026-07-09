import { buildSsoToken, parseSsoToken } from '../sso-token'

// Pure build/parse of the HMAC-signed SSO bridge token. The single-use consume
// (mintSsoToken/consumeSsoToken) is DB-backed and not unit-tested here.
const ORIGINAL = process.env.NEXTAUTH_SECRET
beforeAll(() => { process.env.NEXTAUTH_SECRET = 'test-nextauth-secret' })
afterAll(() => { process.env.NEXTAUTH_SECRET = ORIGINAL })

describe('SSO token (build/parse)', () => {
  const future = Date.now() + 60_000

  it('round-trips its parts', () => {
    const token = buildSsoToken('usr_123', future, 'nonce_abc')
    expect(parseSsoToken(token)).toEqual({ userId: 'usr_123', expiry: future, nonce: 'nonce_abc' })
  })

  it('rejects a tampered token', () => {
    const token = buildSsoToken('usr_123', future, 'nonce_abc')
    expect(parseSsoToken(token.slice(0, -4) + 'aaaa')).toBeNull()
  })

  it('rejects a malformed token', () => {
    expect(parseSsoToken('garbage')).toBeNull()
    expect(parseSsoToken('')).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = buildSsoToken('usr_123', Date.now() - 1000, 'nonce_abc')
    expect(parseSsoToken(token)).toBeNull()
  })
})
