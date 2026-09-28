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
  counts: true,
  status: 'Counts on the return',
  amount: '£5,100.00',
  scheme: 'EU Emissions Trading System (EU ETS)',
  basis: '100 tCO₂e at 60.00 EUR per tCO₂e, converted at 0.85 (rate of 15 April 2027)',
  summary: 'Unverified carbon price — please review',
  qualifications: ['The carbon price behind this claim has not been verified. The relief still applies.'],
  statement: { attached: false, label: 'No verifier’s statement yet', statementId: null },
}
const replaced = { ...counting, id: 'c-1', counts: false, status: 'Replaced by a later claim', amount: '£7,000.00' }
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

    expect(await screen.findByText('Counts on the return')).toBeInTheDocument()
    expect(screen.getByText('Replaced by a later claim')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach the statement' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Preview the relief' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Claim again/ })).toBeInTheDocument()
  })

  it('links the statement once it is attached, and asks for nothing more', async () => {
    const verified = {
      ...counting,
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
})
