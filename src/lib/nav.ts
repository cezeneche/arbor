// Portal navigation model — the spine each user actually walks.
//
// Supplier: Upload → Review → Records → Requests (plus Overview + Settings).
// Buyer keeps the richer surface (Entity network, Export) under the same discipline.
// Reads-not-fills tools (Benchmarks, Activity, Access) live under Settings, not the
// primary nav. Query and Data quality are folded into Records. The request family
// (Requests / Email requests / Shared links / Questionnaires) keeps separate routes
// but is grouped under one "Requests" nav entry via `match`.

export type EntityType = 'SUPPLIER' | 'BUYER'

export type NavLink = {
  href: string
  label: string
  /** Additional path prefixes that also mark this link active (grouped routes). */
  match?: string[]
}

const REQUESTS_GROUP = ['/inbound-requests', '/shares', '/questionnaires']

// Definitions describes what the stored records mean, so it folds into Records
// rather than claiming a seventh slot — the same treatment Query and Data quality
// already get. Reached from the Records page and from a notification link.
const RECORDS_GROUP = ['/definitions']

// CBAM is the first module of a parent Emissions section, not a top-level item.
// The parent exists from day one even though only one child does, so
// Sustainability (scopes 1-3) slots in later without a URL migration — and so the
// nav is not rearranged in front of users who have already learned it.
//
// CBAM cases, consignments, goods lines, installations and declarations live
// entirely under here. They are not records and are not pushed into Arbor's
// record model.
const EMISSIONS: NavLink = { href: '/emissions', label: 'Emissions' }

const SUPPLIER_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/upload', label: 'Upload' },
  { href: '/review', label: 'Review' },
  { href: '/records', label: 'Records', match: RECORDS_GROUP },
  { href: '/requests', label: 'Requests', match: REQUESTS_GROUP },
  EMISSIONS,
  { href: '/settings', label: 'Settings' },
]

const BUYER_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/upload', label: 'Ingest' },
  { href: '/review', label: 'Review' },
  { href: '/records', label: 'Records', match: RECORDS_GROUP },
  { href: '/requests', label: 'Requests', match: REQUESTS_GROUP },
  { href: '/supply-chain', label: 'Entity network' },
  EMISSIONS,
  { href: '/export', label: 'Export' },
  { href: '/settings', label: 'Settings' },
]

export function getNavLinks(entityType: EntityType): NavLink[] {
  return entityType === 'BUYER' ? BUYER_LINKS : SUPPLIER_LINKS
}

export function isLinkActive(link: NavLink, pathname: string): boolean {
  const prefixes = [link.href, ...(link.match ?? [])]
  return prefixes.some(
    p => pathname === p || (p !== '/dashboard' && pathname.startsWith(p + '/')),
  )
}
