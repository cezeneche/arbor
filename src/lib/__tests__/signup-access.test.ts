import { checkSignupAccess } from '../signup-access'

// Arbor is an invite-only pilot: plans are agreed directly and there is no
// self-service billing, so an open signup form sold something that did not
// exist. Signup takes an invite code unless it has been deliberately opened.
describe('checkSignupAccess', () => {
  it('lets anyone in when signup has been opened', () => {
    expect(checkSignupAccess(undefined, { SIGNUP_OPEN: 'true' })).toEqual({ allowed: true })
  })

  it('lets in a valid invite code, ignoring case and spaces', () => {
    const env = { PILOT_INVITE_CODES: 'ACME-2026, steelco-pilot' }
    expect(checkSignupAccess(' acme-2026 ', env)).toEqual({ allowed: true })
    expect(checkSignupAccess('STEELCO-PILOT', env)).toEqual({ allowed: true })
  })

  it('refuses a missing or wrong code', () => {
    const env = { PILOT_INVITE_CODES: 'ACME-2026' }
    expect(checkSignupAccess(undefined, env)).toEqual({ allowed: false, reason: 'invite_required' })
    expect(checkSignupAccess('nope', env)).toEqual({ allowed: false, reason: 'invite_required' })
  })

  it('is closed when no codes are configured and signup is not open', () => {
    expect(checkSignupAccess('anything', {})).toEqual({ allowed: false, reason: 'closed' })
    expect(checkSignupAccess('anything', { PILOT_INVITE_CODES: ' , ' })).toEqual({ allowed: false, reason: 'closed' })
  })
})
