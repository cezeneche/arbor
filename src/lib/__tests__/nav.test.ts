import { getNavLinks, isLinkActive } from '@/lib/nav'

// The Jobs restructure: the portal collapses to a spine the user actually walks.
// Supplier verbs: Upload → Review → Records → Requests, plus Overview + Settings.
// Buyer keeps the richer surface (Entity network, Export) but with the same discipline.
// Reads-not-fills tools (Benchmarks, Activity, Access) move under Settings — they must
// NOT appear in the primary nav. Query and Data quality fold into Records.

describe('getNavLinks — supplier spine', () => {
  const links = getNavLinks('SUPPLIER')
  const labels = links.map(l => l.label)
  const hrefs = links.map(l => l.href)

  it('is the four-verb spine plus Overview and Settings, in order', () => {
    expect(labels).toEqual(['Overview', 'Upload', 'Review', 'Records', 'Requests', 'Settings'])
  })

  it('does not surface reads-not-fills tools in primary nav', () => {
    expect(hrefs).not.toContain('/benchmarks')
    expect(hrefs).not.toContain('/activity')
    expect(hrefs).not.toContain('/analytics')
    expect(hrefs).not.toContain('/query')
    expect(hrefs).not.toContain('/inbound-requests')
    expect(hrefs).not.toContain('/shares')
    expect(hrefs).not.toContain('/questionnaires')
  })
})

describe('getNavLinks — buyer spine', () => {
  const links = getNavLinks('BUYER')
  const labels = links.map(l => l.label)
  const hrefs = links.map(l => l.href)

  it('relabels upload as Ingest and keeps the buyer-only surfaces', () => {
    expect(labels).toEqual(['Overview', 'Ingest', 'Review', 'Records', 'Requests', 'Entity network', 'Export', 'Settings'])
  })

  it('moves reads-not-fills tools (Benchmarks, Activity, Access) under Settings', () => {
    expect(hrefs).not.toContain('/benchmarks')
    expect(hrefs).not.toContain('/activity')
    expect(hrefs).not.toContain('/access')
    expect(hrefs).not.toContain('/query')
    expect(hrefs).not.toContain('/analytics')
  })
})

describe('isLinkActive', () => {
  const supplier = getNavLinks('SUPPLIER')
  const requests = supplier.find(l => l.href === '/requests')!
  const overview = supplier.find(l => l.href === '/dashboard')!
  const records = supplier.find(l => l.href === '/records')!

  it('marks Requests active across its grouped sibling routes', () => {
    expect(isLinkActive(requests, '/requests')).toBe(true)
    expect(isLinkActive(requests, '/inbound-requests')).toBe(true)
    expect(isLinkActive(requests, '/shares')).toBe(true)
    expect(isLinkActive(requests, '/questionnaires')).toBe(true)
    expect(isLinkActive(requests, '/questionnaires/cbam')).toBe(true)
  })

  it('does not mark Overview active on other top-level routes', () => {
    expect(isLinkActive(overview, '/dashboard')).toBe(true)
    expect(isLinkActive(overview, '/records')).toBe(false)
  })

  it('marks a link active on its own sub-routes', () => {
    expect(isLinkActive(records, '/records')).toBe(true)
    expect(isLinkActive(records, '/records/abc')).toBe(true)
    expect(isLinkActive(records, '/requests')).toBe(false)
  })

  it('marks Records active on Definitions — what the records mean folds into Records', () => {
    // Definitions describes the stored records rather than being a seventh verb,
    // so it gets the same treatment Query and Data quality already have and the
    // spine stays six items wide.
    expect(isLinkActive(records, '/definitions')).toBe(true)
  })
})
