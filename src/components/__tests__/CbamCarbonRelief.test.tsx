/**
 * @jest-environment jsdom
 */

// Relief on one goods line shows its claims and then the one thing it needs
// next. Driven against the shape the relief route returns.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import { LineRelief } from '../CbamCarbonRelief'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'

const case_ = { id: 'case-1', origin_country: 'SE', estimated_liability_gbp: 10000 } as CbamCaseSummary

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
function answer(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
}

const counting = {
  id: 'c-2',
  latest: true,
  counts: false,
  status: 'Not counted until the verifier’s statement is attached',
  amount: '£5,100.00',
  scheme: 'EU Emissions Trading System (EU ETS)',
  basis: '100 tCO₂e at 60.00 EUR per tCO₂e, converted at 0.85 (rate of 15 April 2027)',
  summary: 'Unverified carbon price — please review',
  qualifications: [
    'The carbon price behind this claim has not been verified, so the relief is not counted on the return until the verifier’s statement is attached.',
  ],
  statement: { attached: false, label: 'No verifier’s statement yet', statementId: null },
}
const replaced = { ...counting, id: 'c-1', latest: false, counts: false, status: 'Replaced by a later claim', amount: '£7,000.00' }
const schemes = {
  eligible: true,
  message: null,
  options: [
    { name: 'EU Emissions Trading System (EU ETS)', currency: 'EUR' },
    { name: 'Swedish Carbon Tax', currency: 'SEK' },
  ],
}

describe('LineRelief', () => {
  it('asks for a claim when there is none, under a scheme the importer chooses', async () => {
    fetchMock.mockReturnValue(answer({ origin: 'SE', schemes, claims: [], next: 'claim', retryStatementId: null, retryProblem: null }))
    render(<LineRelief case_={case_} lineId="gl-1" />)

    expect(await screen.findByRole('button', { name: 'Preview the relief' })).toBeDisabled()
    expect(screen.getByText(/Carbon price paid \(EUR per tCO₂e\)/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Scheme'), 'Swedish Carbon Tax')
    expect(screen.getByText(/Carbon price paid \(SEK per tCO₂e\)/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cbam/cases/case-1/goods-lines/gl-1/relief')
  })

  it("shows which claim counts and asks for the verifier's statement behind it", async () => {
    fetchMock.mockReturnValue(
      answer({ origin: 'SE', schemes, claims: [counting, replaced], next: 'statement', retryStatementId: null, retryProblem: null }),
    )
    render(<LineRelief case_={case_} lineId="gl-1" />)

    expect(await screen.findByText('Not counted until the verifier’s statement is attached')).toBeInTheDocument()
    expect(screen.getByText('Replaced by a later claim')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach the statement' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Preview the relief' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Claim again/ })).toBeInTheDocument()
  })

  it('links the statement once it is attached, and asks for nothing more', async () => {
    const verified = {
      ...counting,
      counts: true,
      status: 'Counts on the return',
      summary: 'Verified carbon price',
      qualifications: [],
      statement: { attached: true, label: 'Verifier’s statement from V Ltd (UKAS 1)', statementId: 'stmt-1' },
    }
    fetchMock.mockReturnValue(answer({ origin: 'SE', schemes, claims: [verified], next: 'none', retryStatementId: null, retryProblem: null }))
    render(<LineRelief case_={case_} lineId="gl-1" />)

    expect(await screen.findByRole('link', { name: 'View statement' })).toHaveAttribute(
      'href',
      '/api/cbam/cases/case-1/goods-lines/gl-1/verification/stmt-1/file',
    )
    expect(screen.queryByRole('button', { name: 'Attach the statement' })).not.toBeInTheDocument()
  })

  it('says why relief cannot be claimed, and offers no form', async () => {
    fetchMock.mockReturnValue(
      answer({
        origin: 'TR',
        schemes: { eligible: false, message: 'Goods from TR are not covered.', options: [] },
        claims: [],
        next: 'claim',
        retryStatementId: null,
        retryProblem: null,
      }),
    )
    render(<LineRelief case_={case_} lineId="gl-1" />)
    expect(await screen.findByText('Goods from TR are not covered.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview the relief' })).not.toBeInTheDocument()
  })

  it('offers a retry for a statement that did not reach the claim', async () => {
    fetchMock.mockReturnValue(
      answer({ origin: 'SE', schemes, claims: [counting], next: 'retry', retryStatementId: 'stmt-3', retryProblem: 'Nucleos was down.' }),
    )
    render(<LineRelief case_={case_} lineId="gl-1" />)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing needs uploading again/)).toBeInTheDocument()
  })

  // The case's estimated liability is not this line's charge, and is unknown
  // while HMRC's rate is unpublished — when it capped relief at £0. The return
  // caps each line's relief at that line's own charge instead.
  it('previews and claims relief without capping it against the case liability', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/relief')
        ? answer({ origin: 'SE', schemes, claims: [], next: 'claim', retryStatementId: null, retryProblem: null })
        : url.startsWith('/api/cbam/relief/exchange-rate')
          ? answer({ held: false, message: 'Not held.' })
          : answer({
              cpr_amount_gbp: '5950.00',
              cpr_raw_gbp: '5950.00',
              effective_carbon_price_gbp: '59.50',
              cpr_capped: false,
              cbam_liability_gbp: null,
              warnings: [],
            }),
    )
    render(<LineRelief case_={case_} lineId="gl-1" />)

    await userEvent.type(await screen.findByLabelText('Verified emissions'), '100')
    await userEvent.type(screen.getByLabelText('Carbon price'), '70')
    await userEvent.type(screen.getByLabelText('Exchange rate'), '0.85')
    await userEvent.type(screen.getByLabelText('Date of the exchange rate'), '2027-04-15')
    await userEvent.click(screen.getByRole('button', { name: 'Preview the relief' }))

    expect(await screen.findByText('£5,950.00')).toBeInTheDocument()
    expect(screen.getByText(/capped at the CBAM charge on these goods/)).toBeInTheDocument()
    expect(screen.queryByText('Left owing after relief')).not.toBeInTheDocument()
    const preview = fetchMock.mock.calls.find(([u]) => u === '/api/cbam/cpr-calculate')!
    expect(JSON.parse(preview[1].body)).not.toHaveProperty('cbam_liability_gbp')
  })

  describe("HMRC's exchange rate", () => {
    function withRate(rate: unknown) {
      fetchMock.mockImplementation((url: string) =>
        url.endsWith('/relief')
          ? answer({ origin: 'SE', schemes, claims: [], next: 'claim', retryStatementId: null, retryProblem: null })
          : answer(rate),
      )
    }

    it('fills in the rate HMRC published for the month, and names it', async () => {
      withRate({ held: true, rate: '0.8365', label: 'HMRC’s EUR rate for April 2027 (reference table 2027-uk-v1)' })
      render(<LineRelief case_={case_} lineId="gl-1" />)
      await userEvent.type(await screen.findByLabelText('Date of the exchange rate'), '2027-04-15')

      expect(await screen.findByText('HMRC’s EUR rate for April 2027 (reference table 2027-uk-v1)')).toBeInTheDocument()
      expect(screen.getByLabelText('Exchange rate')).toHaveValue(0.8365)
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/cbam/relief/exchange-rate?currency=EUR&date=2027-04-15')).toBe(true)
    })

    it('says so when the month is not held, and leaves the rate to be typed', async () => {
      withRate({ held: false, message: 'HMRC’s EUR rate for May 2027 is not held yet. Enter it from HMRC’s monthly exchange rates.' })
      render(<LineRelief case_={case_} lineId="gl-1" />)
      await userEvent.type(await screen.findByLabelText('Date of the exchange rate'), '2027-05-15')

      expect(await screen.findByText(/May 2027 is not held yet/)).toBeInTheDocument()
      expect(screen.getByLabelText('Exchange rate')).toHaveValue(null)
    })

    it('points out a typed rate that differs from HMRC’s', async () => {
      withRate({ held: true, rate: '0.8365', label: 'HMRC’s EUR rate for April 2027 (reference table 2027-uk-v1)' })
      render(<LineRelief case_={case_} lineId="gl-1" />)
      await userEvent.type(await screen.findByLabelText('Exchange rate'), '0.9')
      await userEvent.type(screen.getByLabelText('Date of the exchange rate'), '2027-04-15')

      expect(await screen.findByText('This differs from HMRC’s rate of 0.8365 for the month.')).toBeInTheDocument()
      expect(screen.getByLabelText('Exchange rate')).toHaveValue(0.9)
    })
  })
})
