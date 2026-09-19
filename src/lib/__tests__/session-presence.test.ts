import { hasSignedInUser } from '../session-presence'

// The routing proxy decided "signed in" with `!!req.auth`. Auth.js can hand the
// middleware a truthy object that is not a session — an error or a
// half-populated value (GHSA-8fpg-xm3f-6cx3) — and a truthiness test lets that
// through every gate the proxy keeps. Only a user with an id counts.
describe('hasSignedInUser', () => {
  it('is true for a session with a user id', () => {
    expect(hasSignedInUser({ user: { id: 'user-1' }, expires: '2099-01-01' })).toBe(true)
  })

  it('is false for no session', () => {
    expect(hasSignedInUser(null)).toBe(false)
    expect(hasSignedInUser(undefined)).toBe(false)
  })

  it('is false for a truthy value that is not a signed-in user', () => {
    expect(hasSignedInUser({})).toBe(false)
    expect(hasSignedInUser({ message: 'Configuration' })).toBe(false)
    expect(hasSignedInUser({ user: {} })).toBe(false)
    expect(hasSignedInUser({ user: { id: '' } })).toBe(false)
    expect(hasSignedInUser({ user: { id: 42 } })).toBe(false)
  })
})
