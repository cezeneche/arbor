// Whether the routing proxy's session is a signed-in user. Pure and Edge-safe.
//
// `!!req.auth` treats any truthy value as a session, including an error object
// or a half-populated one (GHSA-8fpg-xm3f-6cx3). Only a user with an id counts.
export function hasSignedInUser(auth: unknown): boolean {
  const id = (auth as { user?: { id?: unknown } } | null | undefined)?.user?.id
  return typeof id === 'string' && id.length > 0
}
