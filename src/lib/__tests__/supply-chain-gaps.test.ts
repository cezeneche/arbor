import { computeScopedGaps, grantedDomains, type GapRecord } from '@/lib/layer3/supply-chain-gaps'
import type { GrantScope } from '@/lib/layer3/grant-scope'
import type { DataDomain } from '@prisma/client'

const ALL = [
  'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
  'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
] as DataDomain[]

const rec = (domain: string, trustTier: string, start = '2026-01-01', end = '2026-12-31'): GapRecord => ({
  domain: domain as DataDomain,
  trustTier,
  periodStart: new Date(start),
  periodEnd: new Date(end),
})

describe('grantedDomains', () => {
  it('a null-domain (unbounded) grant grants all domains', () => {
    expect(grantedDomains([{ domain: null, periodStart: null, periodEnd: null }], ALL)).toEqual(ALL)
  })

  it('domain-scoped grants grant only their named domains', () => {
    const grants: GrantScope[] = [
      { domain: 'ENERGY' as DataDomain, periodStart: null, periodEnd: null },
      { domain: 'LOGISTICS' as DataDomain, periodStart: null, periodEnd: null },
    ]
    expect(grantedDomains(grants, ALL)).toEqual(['LOGISTICS', 'ENERGY'].sort() as unknown as DataDomain[])
  })
})

describe('computeScopedGaps', () => {
  it('never reports a domain the buyer was not granted', () => {
    // Energy-only grant; supplier has an Energy record and a Logistics record.
    const grants: GrantScope[] = [{ domain: 'ENERGY' as DataDomain, periodStart: null, periodEnd: null }]
    const records = [rec('ENERGY', 'A'), rec('LOGISTICS', 'A')]
    const { missingDomains, estimatedOnlyDomains } = computeScopedGaps(grants, records, ALL)
    // Only ENERGY is in scope, and it is covered → no gaps, no leakage of other domains.
    expect(missingDomains).toEqual([])
    expect(estimatedOnlyDomains).toEqual([])
  })

  it('reports a granted domain with no in-scope records as missing', () => {
    const grants: GrantScope[] = [{ domain: 'ENERGY' as DataDomain, periodStart: null, periodEnd: null }]
    const { missingDomains } = computeScopedGaps(grants, [], ALL)
    expect(missingDomains).toEqual(['ENERGY'])
  })

  it('ignores records outside the grant period', () => {
    // Grant covers only 2025; the only Energy record is 2026 → out of scope → missing.
    const grants: GrantScope[] = [
      { domain: 'ENERGY' as DataDomain, periodStart: new Date('2025-01-01'), periodEnd: new Date('2025-12-31') },
    ]
    const records = [rec('ENERGY', 'A', '2026-01-01', '2026-12-31')]
    const { missingDomains } = computeScopedGaps(grants, records, ALL)
    expect(missingDomains).toEqual(['ENERGY'])
  })

  it('flags a granted domain with only Tier C records as estimated-only', () => {
    const grants: GrantScope[] = [{ domain: 'ENERGY' as DataDomain, periodStart: null, periodEnd: null }]
    const records = [rec('ENERGY', 'C')]
    const { missingDomains, estimatedOnlyDomains } = computeScopedGaps(grants, records, ALL)
    expect(missingDomains).toEqual([])
    expect(estimatedOnlyDomains).toEqual(['ENERGY'])
  })

  it('an unbounded grant considers all domains and reports the empty ones', () => {
    const grants: GrantScope[] = [{ domain: null, periodStart: null, periodEnd: null }]
    const records = [rec('ENERGY', 'A')]
    const { missingDomains } = computeScopedGaps(grants, records, ALL)
    expect(missingDomains).toEqual(ALL.filter((d) => d !== 'ENERGY'))
  })
})
