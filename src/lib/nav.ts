// Home is the decision surface. Documents contains upload and review; Your data
// contains the reusable records. Requests and sharing have distinct ownership.

export type EntityType = 'SUPPLIER' | 'BUYER'

export type NavLink = {
  href: string
  label: string
  /** Additional path prefixes that also mark this link active (grouped routes). */
  match?: string[]
}

const REQUESTS_GROUP = ['/inbound-requests', '/questionnaires']

// Definitions describes what the stored records mean, so it folds into Records
// rather than claiming a seventh slot — the same treatment Query and Data quality
// already get. Reached from the Records page and from a notification link.
const RECORDS_GROUP = ['/definitions']

// CBAM is its own section, and its screens are views of one section rather than
// separate destinations — the same quiet ?view= toggle Records uses for Trends
// and Benchmarks, not tabs and not a nested nav.
//
// This is a deliberate override of the integration plan, which put CBAM under a
// parent Emissions section. The cost is a URL migration if a second emissions
// module ever arrives; the gain is that the thing users actually came for is one
// click away rather than two, and the section reads the way the rest of the
// product already does.
//
// CBAM cases, consignments, goods lines, installations and declarations live
// entirely under here. They are not records and are not pushed into Arbor's
// record model.
const CBAM: NavLink = { href: '/cbam', label: 'CBAM' }

function supplierLinks(showCbam: boolean): NavLink[] {
  return [
    { href: '/dashboard', label: 'Home' },
    { href: '/records', label: 'Your data', match: RECORDS_GROUP },
    { href: '/documents', label: 'Documents', match: ['/upload', '/review'] },
    { href: '/requests', label: 'Requests', match: REQUESTS_GROUP },
    { href: '/shares', label: 'Sharing', match: ['/access'] },
    ...(showCbam ? [CBAM] : []),
    { href: '/settings', label: 'Settings' },
  ]
}

function buyerLinks(showCbam: boolean): NavLink[] {
  return [
    { href: '/dashboard', label: 'Home' },
    { href: '/records', label: 'Your data', match: RECORDS_GROUP },
    { href: '/documents', label: 'Documents', match: ['/upload', '/review'] },
    { href: '/requests', label: 'Requests', match: REQUESTS_GROUP },
    { href: '/shares', label: 'Sharing', match: ['/access'] },
    { href: '/supply-chain', label: 'Suppliers' },
    ...(showCbam ? [CBAM] : []),
    { href: '/export', label: 'Export' },
    { href: '/settings', label: 'Settings' },
  ]
}

/**
 * Whether CBAM belongs in this organisation's navigation. Most suppliers never
 * import CBAM goods, and a section that means nothing to them is exactly what
 * the simplicity rule (PRD §7) keeps out. It appears once the organisation
 * switches it on — the scope check is useful before any document exists — or
 * as soon as there is CBAM activity: a customs or CBAM declaration, or a case.
 */
export function showsCbam(org: { enabled: boolean; cbamDocuments: number; caseLinks: number }): boolean {
  return org.enabled || org.cbamDocuments > 0 || org.caseLinks > 0
}

export function getNavLinks(
  entityType: EntityType,
  opts: { showCbam?: boolean; isPlatformAdmin?: boolean } = {},
): NavLink[] {
  const showCbam = opts.showCbam ?? false
  const links = entityType === 'BUYER' ? buyerLinks(showCbam) : supplierLinks(showCbam)
  // Operators review pilot and institutional enquiries; nobody else sees the link.
  return opts.isPlatformAdmin ? [...links, { href: '/admin/enquiries', label: 'Enquiry review' }] : links
}

export function isLinkActive(link: NavLink, pathname: string): boolean {
  const prefixes = [link.href, ...(link.match ?? [])]
  return prefixes.some(p => pathname === p || (p !== '/dashboard' && pathname.startsWith(p + '/')))
}
