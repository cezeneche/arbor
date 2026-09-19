// What the routing proxy does with a request that has no session. Pure and
// Edge-safe. API callers get a 401 they can act on; a redirect to an HTML login
// page is followed silently by fetch() and read as a 200.
export function unauthenticatedAction(pathname: string): 'json-401' | 'redirect-login' {
  return pathname === '/api' || pathname.startsWith('/api/') ? 'json-401' : 'redirect-login'
}
