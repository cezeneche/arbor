import { reportingPeriodEnd, reviewTier, type ReviewTierInput } from '../review-tier'

// One decision for the review screen and the confirm route (code review R1).

const rego = (expiry: string): Map<string, string | null> =>
  new Map([
    ['certificate_type', 'REGO'],
    ['issuing_body', 'Ofgem'],
    ['certificate_number', 'R-0001'],
    ['holder_name', 'Acme Steel Ltd'],
    ['vintage_year', '2025'],
    ['quantity_mwh', '120'],
    ['technology_type', 'Wind'],
    ['generation_country', 'GB'],
    ['expiry_date', expiry],
  ])

function input(expiry: string, recordPeriodEnds: string[]): ReviewTierInput {
  const extracted = rego(expiry)
  return {
    documentType: 'RENEWABLE_CERTIFICATE',
    cbam: false,
    hasExtraction: true,
    extracted,
    confirmed: new Map([...extracted].map(([k, v]) => [k, v ?? ''])),
    sourceText: new Map([...extracted].map(([k, v]) => [k, `${k}: ${v}`])),
    entityName: 'Acme Steel Ltd',
    recordPeriodEnds,
  }
}

describe('reviewTier', () => {
  const yearEnd = ['2025-12-31T23:59:59.999Z']

  it('refuses Verified to a certificate that expired before its period ended', () => {
    expect(reviewTier(input('2025-06-30', yearEnd))).toBe('B')
  })

  it('gives Verified to one valid through its period', () => {
    expect(reviewTier(input('2026-12-31', yearEnd))).toBe('A')
  })

  it('judges a CBAM document on its goods lines, and needs something read', () => {
    const cbam = { ...input('2026-12-31', yearEnd), cbam: true, documentType: 'CUSTOMS_DECLARATION' }
    expect(reviewTier({ ...cbam, confirmed: new Map() })).toBe('B')
    expect(reviewTier({ ...cbam, hasExtraction: false })).toBe('B')
  })
})

describe('reportingPeriodEnd', () => {
  it('is the latest period end, ignoring anything unparseable', () => {
    expect(reportingPeriodEnd(['2025-03-31T00:00:00Z', 'nonsense', '2025-12-31T00:00:00Z'])).toEqual(
      new Date('2025-12-31T00:00:00Z'),
    )
  })

  it('is undefined when there are no records', () => {
    expect(reportingPeriodEnd([])).toBeUndefined()
  })
})
