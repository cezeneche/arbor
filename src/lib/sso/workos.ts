// WorkOS SSO via the WorkOS REST API (no SDK dependency).
// All functions read configuration lazily so importing this module never
// requires the env vars at build time. SSO is disabled if unconfigured.
const WORKOS_BASE = 'https://api.workos.com'

export function isSsoConfigured(): boolean {
  return !!process.env.WORKOS_API_KEY && !!process.env.WORKOS_CLIENT_ID
}

function apiKey(): string {
  const k = process.env.WORKOS_API_KEY
  if (!k) throw new Error('WORKOS_API_KEY is not set')
  return k
}

// Build the authorization URL to redirect the user to their IdP for `organizationId`.
export function getAuthorizationUrl(organizationId: string, redirectUri: string, state?: string): string {
  const clientId = process.env.WORKOS_CLIENT_ID
  if (!clientId) throw new Error('WORKOS_CLIENT_ID is not set')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    provider: 'authkit',
    organization: organizationId,
  })
  if (state) params.set('state', state)
  return `${WORKOS_BASE}/sso/authorize?${params.toString()}`
}

export interface WorkOsProfile {
  email: string
  firstName: string | null
  lastName: string | null
  organizationId: string | null
}

// Exchange an authorization code for the authenticated user's profile.
export async function authenticateWithCode(code: string): Promise<WorkOsProfile> {
  const clientId = process.env.WORKOS_CLIENT_ID
  if (!clientId) throw new Error('WORKOS_CLIENT_ID is not set')

  const res = await fetch(`${WORKOS_BASE}/sso/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: apiKey(),
      grant_type: 'authorization_code',
      code,
    }),
  })
  if (!res.ok) throw new Error(`WorkOS token exchange failed: ${res.status}`)
  const data = (await res.json()) as { profile?: Record<string, unknown> }
  const p = data.profile ?? {}
  return {
    email: String(p.email ?? ''),
    firstName: (p.first_name as string) ?? null,
    lastName: (p.last_name as string) ?? null,
    organizationId: (p.organization_id as string) ?? null,
  }
}
