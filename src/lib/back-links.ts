// Where every sub-page goes back to.
//
// The nav (src/lib/nav.ts) is deliberately flat — six or eight entries, no tabs,
// no nesting. That leaves the screens reached *from* a nav page (a questionnaire,
// a webhook list, one supplier's records) with no visible way home. This map is
// that way home: one declared parent per sub-page, so the wording is identical
// everywhere and no screen invents its own.
//
// Keys are matched longest-first, so a two-level page steps back one level at a
// time rather than jumping to the top.

export interface ParentLink {
  href: string
  label: string
}

const REQUESTS: ParentLink = { href: '/requests', label: 'Requests' }
const SETTINGS: ParentLink = { href: '/settings', label: 'Settings' }
const RECORDS: ParentLink = { href: '/records', label: 'Records' }
const SUPPLY_CHAIN: ParentLink = { href: '/supply-chain', label: 'Entity network' }
const QUESTIONNAIRES: ParentLink = { href: '/questionnaires', label: 'Questionnaires' }
const REVIEW: ParentLink = { href: '/review', label: 'Review' }

/**
 * Path prefix → the screen it sits underneath. A path matches a key when it is
 * the key itself or a route beneath it.
 */
export const PORTAL_PARENTS: Record<string, ParentLink> = {
  // Records group — what the stored figures mean.
  '/definitions': RECORDS,

  // Request family — everything a customer can ask for.
  '/requests/data': REQUESTS,
  '/inbound-requests': REQUESTS,
  '/shares': REQUESTS,
  '/questionnaires': REQUESTS,

  // Settings group, including the reads-not-fills tools linked from Settings.
  '/settings/api-keys': SETTINGS,
  '/settings/integrations': SETTINGS,
  '/settings/sso': SETTINGS,
  '/settings/stewards': SETTINGS,
  '/settings/webhooks': SETTINGS,
  '/activity': SETTINGS,
  '/access': SETTINGS,

  // Buyer surfaces.
  '/supply-chain/request': SUPPLY_CHAIN,
}

/** Dynamic routes, whose middle segment is an id we cannot enumerate. */
const PATTERN_PARENTS: { test: RegExp; parent: ParentLink }[] = [
  { test: /^\/questionnaires\/[^/]+$/, parent: QUESTIONNAIRES },
  { test: /^\/supply-chain\/[^/]+\/records$/, parent: SUPPLY_CHAIN },
  { test: /^\/upload\/[^/]+\/review$/, parent: REVIEW },
]

function normalise(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * The screen `pathname` sits underneath, or null when it is a top-level
 * destination (or a path we do not recognise — better no button than a wrong one).
 */
export function parentOf(pathname: string): ParentLink | null {
  const path = normalise(pathname)

  for (const { test, parent } of PATTERN_PARENTS) {
    if (test.test(path)) return parent
  }

  // Longest key first so /settings/webhooks beats a hypothetical /settings.
  const keys = Object.keys(PORTAL_PARENTS).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (path === key || path.startsWith(key + '/')) return PORTAL_PARENTS[key]
  }

  return null
}
