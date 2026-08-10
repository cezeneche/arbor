import { presentCase, summariseExposure } from '../case-presenter'
import type { CbamCaseSummary } from '../cases-client'

function makeCase(over: Partial<CbamCaseSummary> = {}): CbamCaseSummary {
  return {
    id: 'case-1',
    importer_name: 'Northern Steel Stockholders Ltd',
    importer_eori: 'GB123456789000',
    reporting_year: 2027,
    reporting_quarter: 1,
    status: 'draft',
    sector: 'iron_steel',
    origin_country: 'TR',
    total_net_mass_kg: 24500,
    estimated_liability_gbp: 184500,
    estimated_liability_unavailable: null,
    ...over,
  }
}

describe('presentCase', () => {
  it('renders the row a user reads', () => {
    const row = presentCase(makeCase())
    expect(row.importer).toBe('Northern Steel Stockholders Ltd')
    expect(row.period).toBe('Q1 2027')
    expect(row.sector).toBe('Iron Steel')
    expect(row.mass).toBe('24.5 t')
    expect(row.exposure).toBe('£184,500')
    expect(row.href).toBe('/cbam/case-1')
  })

  it('falls back to the EORI when no name is held', () => {
    expect(presentCase(makeCase({ importer_name: null })).importer).toBe('GB123456789000')
  })

  it('renders an em-dash, not a zero, when exposure is withheld', () => {
    // A zero reads as "no exposure", which is the opposite of "unknown".
    const row = presentCase(
      makeCase({
        estimated_liability_gbp: null,
        estimated_liability_unavailable: {
          reason: 'placeholder_rate',
          sectors: ['iron_steel'],
          detail: 'HMRC has not published a CBAM rate for iron_steel',
        },
      }),
    )
    expect(row.exposure).toBe('—')
    expect(row.exposureNote).toContain('HMRC')
  })

  it('still explains a withheld figure when no reason was supplied', () => {
    const row = presentCase(makeCase({ estimated_liability_gbp: null }))
    expect(row.exposure).toBe('—')
    expect(row.exposureNote).toBeTruthy()
  })

  it('adds no note when the figure is real', () => {
    expect(presentCase(makeCase()).exposureNote).toBeNull()
  })

  it('handles an annual case with no quarter', () => {
    expect(presentCase(makeCase({ reporting_quarter: null })).period).toBe('2027')
  })

  it('says so when no period is set', () => {
    expect(presentCase(makeCase({ reporting_year: null })).period).toBe('Period not set')
  })

  it('em-dashes missing mass rather than showing 0.0 t', () => {
    expect(presentCase(makeCase({ total_net_mass_kg: null })).mass).toBe('—')
    expect(presentCase(makeCase({ total_net_mass_kg: 0 })).mass).toBe('—')
  })
})

describe('summariseExposure', () => {
  it('sums the cases that have a figure', () => {
    const summary = summariseExposure([
      makeCase({ estimated_liability_gbp: 100000 }),
      makeCase({ estimated_liability_gbp: 84500 }),
    ])
    expect(summary.total).toBe('£184,500')
    expect(summary.note).toBeNull()
  })

  it('never presents a partial total as a complete one', () => {
    // The same error as a short declaration, on the screen a user looks at first.
    const summary = summariseExposure([
      makeCase({ estimated_liability_gbp: 100000 }),
      makeCase({ estimated_liability_gbp: null }),
    ])
    expect(summary.total).toBe('£100,000')
    expect(summary.withheldCount).toBe(1)
    expect(summary.note).toContain('Excludes 1 case')
  })

  it('pluralises the exclusion note', () => {
    const summary = summariseExposure([
      makeCase({ estimated_liability_gbp: 1 }),
      makeCase({ estimated_liability_gbp: null }),
      makeCase({ estimated_liability_gbp: null }),
    ])
    expect(summary.note).toContain('Excludes 2 cases')
  })

  it('shows an em-dash when nothing can be totalled', () => {
    const summary = summariseExposure([makeCase({ estimated_liability_gbp: null })])
    expect(summary.total).toBe('—')
    expect(summary.note).toMatch(/has not published/i)
  })

  it('says nothing at all when there are no cases', () => {
    const summary = summariseExposure([])
    expect(summary.total).toBe('—')
    expect(summary.note).toBeNull()
  })
})
