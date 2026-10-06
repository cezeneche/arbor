import { presentReliefClaims, reliefNextStep, schemeChoice } from '../relief-presenter'
import type { ReliefClaim } from '../relief-client'

// What an importer sees about relief on one goods line: whether any can be
// claimed and under which scheme, which claim counts on the return, and whether
// a verifier's statement stands behind it.

describe('schemeChoice', () => {
  it('offers each scheme the UK recognises for the origin, priced in its own currency', () => {
    const out = schemeChoice('SE', {
      claimable: true,
      warning: null,
      schemes: [
        { name: 'EU Emissions Trading System (EU ETS)', status: 'confirmed', currency: 'EUR' },
        { name: 'Swedish Carbon Tax', status: 'confirmed', currency: 'SEK' },
      ],
    })
    expect(out).toEqual({
      eligible: true,
      message: null,
      options: [
        { name: 'EU Emissions Trading System (EU ETS)', currency: 'EUR' },
        { name: 'Swedish Carbon Tax', currency: 'SEK' },
      ],
    })
  })

  it('does not offer a scheme the UK has not confirmed yet, and says why', () => {
    const out = schemeChoice('XX', {
      claimable: false,
      warning: 'Pending UK HMRC confirmation.',
      schemes: [{ name: 'Some ETS', status: 'pending', currency: null }],
    })
    expect(out).toEqual({ eligible: false, message: 'Pending UK HMRC confirmation.', options: [] })
  })

  it('says plainly when the origin has no recognised scheme', () => {
    expect(schemeChoice('TR', { claimable: false, warning: null, schemes: [] })).toMatchObject({
      eligible: false,
      message: expect.stringContaining('Goods from TR'),
    })
  })

  it('says plainly when the goods have no origin recorded', () => {
    expect(schemeChoice(null, null)).toMatchObject({
      eligible: false,
      message: expect.stringContaining('no country of origin'),
    })
  })
})

const claim = (over: Partial<ReliefClaim> & { id: string }): ReliefClaim => ({
  created_at: '2027-04-20T10:00:00Z',
  qualifying_scheme_name: 'EU Emissions Trading System (EU ETS)',
  carbon_price_local_currency: 70,
  local_currency_code: 'EUR',
  verified_emissions_tco2e: 100,
  exchange_rate_to_gbp: 0.85,
  exchange_rate_date: '2027-04-15',
  cpr_raw_gbp: 5950,
  cpr_amount_gbp: 5950,
  cpr_capped: false,
  verification_document_hash: null,
  ...over,
})

describe('presentReliefClaims', () => {
  it('counts only the newest claim; earlier ones were replaced', () => {
    const rows = presentReliefClaims(
      [
        claim({
          id: 'old',
          created_at: '2027-04-19T10:00:00Z',
          cpr_amount_gbp: 7000,
          verification_document_hash: 'a'.repeat(64),
        }),
        claim({
          id: 'new',
          created_at: '2027-04-20T10:00:00Z',
          cpr_amount_gbp: '5100.00',
          verification_document_hash: 'a'.repeat(64),
        }),
      ],
      [],
    )
    expect(rows.map(r => [r.id, r.latest, r.counts, r.status, r.amount])).toEqual([
      ['new', true, true, 'Counts on the return', '£5,100.00'],
      ['old', false, false, 'Replaced by a later claim', '£7,000.00'],
    ])
  })

  // Relief needs a verifier's statement before it reduces the return.
  it('does not count the newest claim until its statement is attached', () => {
    const [row] = presentReliefClaims([claim({ id: 'c' })], [])
    expect(row).toMatchObject({
      latest: true,
      counts: false,
      status: 'Not counted until the verifier’s statement is attached',
    })
  })

  it('shows the figures the relief was worked out from', () => {
    const [row] = presentReliefClaims([claim({ id: 'c' })], [])
    expect(row.scheme).toBe('EU Emissions Trading System (EU ETS)')
    expect(row.basis).toBe('100 tCO₂e at 70.00 EUR per tCO₂e, converted at 0.85 (rate of 15 April 2027)')
  })

  it("links the verifier's statement Arbor holds for a claim", () => {
    const [row] = presentReliefClaims(
      [claim({ id: 'c', verification_document_hash: 'a'.repeat(64) })],
      [
        {
          id: 'stmt-1',
          sha256: 'a'.repeat(64),
          verifierName: 'Carbon Assurance Ltd',
          verifierAccreditation: 'UKAS 9876',
        },
      ],
    )
    expect(row.statement).toEqual({
      attached: true,
      label: 'Verifier’s statement from Carbon Assurance Ltd (UKAS 9876)',
      statementId: 'stmt-1',
    })
    expect(row.summary).toBe('Verified carbon price')
  })

  it('marks a claim with no statement as unverified', () => {
    const [row] = presentReliefClaims([claim({ id: 'c' })], [])
    expect(row.statement).toEqual({
      attached: false,
      label: 'No verifier’s statement yet',
      statementId: null,
    })
    expect(row.summary).toBe('Unverified carbon price — please review')
    expect(row.qualifications[0]).toMatch(/not counted on the return/)
  })

  it('says when the relief was capped at the liability', () => {
    const [row] = presentReliefClaims(
      [claim({ id: 'c', cpr_capped: true, cpr_raw_gbp: 9000, cpr_amount_gbp: 4000 })],
      [],
    )
    expect(row.qualifications.join(' ')).toContain('Capped at the CBAM liability')
  })
})

describe('reliefNextStep', () => {
  it('asks for a claim when there is none', () => {
    expect(reliefNextStep([])).toBe('claim')
  })
  it("asks for the verifier's statement when the claim that counts has none", () => {
    expect(reliefNextStep(presentReliefClaims([claim({ id: 'c' })], []))).toBe('statement')
  })
  it('has nothing to ask once the claim that counts is verified', () => {
    const rows = presentReliefClaims([claim({ id: 'c', verification_document_hash: 'b'.repeat(64) })], [])
    expect(reliefNextStep(rows)).toBe('none')
  })
})
