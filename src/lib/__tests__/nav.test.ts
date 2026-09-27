import { getNavLinks, isLinkActive, showsCbam } from '@/lib/nav'

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

  it('adds CBAM after Requests when it is relevant to the organisation', () => {
    expect(getNavLinks('SUPPLIER', { showCbam: true }).map(l => l.label)).toEqual([
      'Overview', 'Upload', 'Review', 'Records', 'Requests', 'CBAM', 'Settings',
    ])
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

  it('adds CBAM after Entity network when it is relevant to the organisation', () => {
    expect(getNavLinks('BUYER', { showCbam: true }).map(l => l.label)).toEqual([
      'Overview', 'Ingest', 'Review', 'Records', 'Requests', 'Entity network', 'CBAM', 'Export', 'Settings',
    ])
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

// CBAM
//
// CBAM is its own section. Its screens are views of that one section, reached by
// the same quiet ?view= toggle Records uses for Trends and Benchmarks — so the
// nav link stays active across them and no sub-navigation is introduced.

describe('CBAM section', () => {
  it('appears for both entity types when relevant', () => {
    for (const type of ['SUPPLIER', 'BUYER'] as const) {
      expect(getNavLinks(type, { showCbam: true }).map(l => l.label)).toContain('CBAM')
    }
  })

  it('sits between Requests and Settings, not at the end', () => {
    const labels = getNavLinks('SUPPLIER', { showCbam: true }).map(l => l.label)
    expect(labels.indexOf('CBAM')).toBeGreaterThan(labels.indexOf('Requests'))
    expect(labels.indexOf('CBAM')).toBeLessThan(labels.indexOf('Settings'))
  })

  it('is a top-level section, not nested under another', () => {
    const cbam = getNavLinks('SUPPLIER', { showCbam: true }).find(l => l.label === 'CBAM')
    expect(cbam?.href).toBe('/cbam')
  })

  it('stays active across its views and its case pages', () => {
    const cbam = getNavLinks('SUPPLIER', { showCbam: true }).find(l => l.label === 'CBAM')!
    expect(isLinkActive(cbam, '/cbam')).toBe(true)
    expect(isLinkActive(cbam, '/cbam/case-123')).toBe(true)
  })

  it('is not activated by an unrelated route that shares a prefix', () => {
    const cbam = getNavLinks('SUPPLIER', { showCbam: true }).find(l => l.label === 'CBAM')!
    expect(isLinkActive(cbam, '/cbam-guide')).toBe(false)
  })

  it('does not claim Records', () => {
    // CBAM cases, consignments and goods lines are not records and must not be
    // pushed into Arbor's record model.
    const records = getNavLinks('SUPPLIER', { showCbam: true }).find(l => l.label === 'Records')!
    expect(isLinkActive(records, '/cbam')).toBe(false)
  })
})

// CBAM sat in every organisation's navigation, though most suppliers never
// import CBAM goods — a section the simplicity rule (PRD §7) says should not be
// there until it means something to them.
describe('showsCbam', () => {
  it('is hidden for an organisation with no CBAM activity that has not asked for it', () => {
    expect(showsCbam({ enabled: false, cbamDocuments: 0, caseLinks: 0 })).toBe(false)
  })

  it('shows once the organisation switches it on, before any document', () => {
    expect(showsCbam({ enabled: true, cbamDocuments: 0, caseLinks: 0 })).toBe(true)
  })

  it('shows once a customs or CBAM declaration has been uploaded', () => {
    expect(showsCbam({ enabled: false, cbamDocuments: 1, caseLinks: 0 })).toBe(true)
  })

  it('shows while the organisation has a case', () => {
    expect(showsCbam({ enabled: false, cbamDocuments: 0, caseLinks: 1 })).toBe(true)
  })
})
