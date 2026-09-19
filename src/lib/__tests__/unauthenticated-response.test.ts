import { unauthenticatedAction } from '../unauthenticated-response'

// An API caller without a session used to get a 307 to /login — HTML for a
// client expecting JSON, and a redirect a fetch() follows silently into a 200
// login page. API paths get a 401 they can act on; pages still redirect.
describe('unauthenticatedAction', () => {
  it('answers an API path with a JSON 401', () => {
    expect(unauthenticatedAction('/api/records')).toBe('json-401')
    expect(unauthenticatedAction('/api/cbam/cases/abc')).toBe('json-401')
  })

  it('redirects a page to sign in', () => {
    expect(unauthenticatedAction('/records')).toBe('redirect-login')
    expect(unauthenticatedAction('/api-docs')).toBe('redirect-login')
  })
})
