import { grantAuthorisesRequest, anyGrantAuthorisesRequest } from '@/lib/requests/authorise-sender'
import type { GrantScope } from '@/lib/layer3/grant-scope'
import type { ParsedRequest } from '@/lib/requests/inbound-parse'
import type { DataDomain } from '@prisma/client'

const req = (over: Partial<ParsedRequest> = {}): ParsedRequest => ({
  domain: 'ENERGY',
  fields: ['total_consumption_kwh'],
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  ...over,
})

const grant = (over: Partial<GrantScope> = {}): GrantScope => ({
  domain: null,
  periodStart: null,
  periodEnd: null,
  ...over,
})

describe('grantAuthorisesRequest', () => {
  it('an unbounded grant authorises any request', () => {
    expect(grantAuthorisesRequest(grant(), req())).toBe(true)
  })

  it('a domain-scoped grant authorises a matching-domain request', () => {
    expect(grantAuthorisesRequest(grant({ domain: 'ENERGY' as DataDomain }), req({ domain: 'ENERGY' }))).toBe(true)
  })

  it('a domain-scoped grant rejects a different-domain request', () => {
    expect(grantAuthorisesRequest(grant({ domain: 'LOGISTICS' as DataDomain }), req({ domain: 'ENERGY' }))).toBe(false)
  })

  it('a domain-scoped grant rejects a domain-less (ambiguous) request', () => {
    expect(grantAuthorisesRequest(grant({ domain: 'ENERGY' as DataDomain }), req({ domain: null }))).toBe(false)
  })

  it('rejects a request whose period is entirely after the grant window', () => {
    const g = grant({ periodStart: new Date('2024-01-01'), periodEnd: new Date('2024-12-31') })
    expect(grantAuthorisesRequest(g, req({ periodStart: '2026-01-01', periodEnd: '2026-12-31' }))).toBe(false)
  })

  it('a period-bounded grant authorises a request that gives no period', () => {
    const g = grant({ periodStart: new Date('2024-01-01'), periodEnd: new Date('2024-12-31') })
    expect(grantAuthorisesRequest(g, req({ periodStart: null, periodEnd: null }))).toBe(true)
  })
})

describe('anyGrantAuthorisesRequest', () => {
  it('is true when at least one grant authorises', () => {
    const grants = [grant({ domain: 'LOGISTICS' as DataDomain }), grant({ domain: 'ENERGY' as DataDomain })]
    expect(anyGrantAuthorisesRequest(grants, req({ domain: 'ENERGY' }))).toBe(true)
  })

  it('is false when no grant authorises (unauthenticated / ungranted sender)', () => {
    expect(anyGrantAuthorisesRequest([], req())).toBe(false)
  })
})
