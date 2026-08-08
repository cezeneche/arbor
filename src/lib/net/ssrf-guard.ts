// Pure URL admissibility rules for outbound requests the platform makes on a
// tenant's behalf — webhook deliveries and ERP integration pulls. No DNS, no
// network, no DB, so it is unit-testable in isolation; safe-fetch.ts wires it to
// resolution and the actual request.
//
// The threat is server-side request forgery: a tenant supplies a URL, Arbor's
// server fetches it, and the tenant gets to reach whatever that server can reach
// — link-local metadata endpoints, databases on the private network, other
// tenants' internal services. "Starts with https://" stopped none of that.

export type OutboundUrlRejection =
  | 'not_a_url'
  | 'scheme'
  | 'credentials'
  | 'blocked_host'
  | 'private_address'

export type OutboundUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: OutboundUrlRejection }

export const OUTBOUND_URL_MESSAGES: Record<OutboundUrlRejection, string> = {
  not_a_url: 'That is not a valid URL.',
  scheme: 'The URL must start with https://.',
  credentials: 'The URL must not contain a username or password.',
  blocked_host: 'That hostname is not reachable from Arbor.',
  private_address: 'The URL must point at a public address, not a private or internal one.',
}

// Hostnames that never legitimately name a tenant's public endpoint.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

/** True for an IPv4 literal outside the publicly routable space. */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map(p => {
    if (!/^\d{1,3}$/.test(p)) return NaN
    return Number(p)
  })
  if (octets.some(o => Number.isNaN(o) || o > 255)) return false
  const [a, b] = octets

  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true // IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 2) return true // TEST-NET-1
  if (a === 192 && b === 88 && octets[2] === 99) return true // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast, reserved, broadcast

  return false
}

/** True for an IPv6 literal outside the publicly routable space, including
 *  IPv4-mapped forms such as ::ffff:169.254.169.254. */
export function isPrivateIpv6(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').toLowerCase().split('%')[0]

  if (addr === '::' || addr === '::1') return true

  // IPv4-mapped / IPv4-compatible — the embedded v4 address is what gets dialled.
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])

  const head = addr.split(':')[0]
  if (!head) return false
  const leading = parseInt(head, 16)
  if (Number.isNaN(leading)) return false

  if ((leading & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((leading & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((leading & 0xff00) === 0xff00) return true // ff00::/8 multicast

  return false
}

/** True when `host` is an IP literal that must not be dialled. Hostnames that are
 *  not IP literals return false here — they are settled by DNS at fetch time. */
export function isPrivateAddress(host: string): boolean {
  if (host.includes(':')) return isPrivateIpv6(host)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host)
  return false
}

/** Validates a tenant-supplied URL for outbound use. Everything decidable from
 *  the string alone is decided here; DNS-dependent checks belong to safe-fetch. */
export function validateOutboundUrl(raw: string): OutboundUrlResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'not_a_url' }
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' }
  if (url.username || url.password) return { ok: false, reason: 'credentials' }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return { ok: false, reason: 'not_a_url' }
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'blocked_host' }
  if (BLOCKED_SUFFIXES.some(s => host.endsWith(s))) return { ok: false, reason: 'blocked_host' }
  // A bare label ("intranet", "db") can only resolve inside a private search domain.
  if (!host.includes('.') && !isPrivateAddress(host)) return { ok: false, reason: 'blocked_host' }
  if (isPrivateAddress(host)) return { ok: false, reason: 'private_address' }

  return { ok: true, url }
}
