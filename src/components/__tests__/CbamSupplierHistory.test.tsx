/**
 * @jest-environment jsdom
 */

// The supplier history under a goods line: the verdict shows without a click,
// a flagged figure stands out, and the earlier figures open inline.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import { CbamSupplierHistory } from '../CbamSupplierHistory'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
function answer(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
}

const flagged = {
  available: true,
  flagged: true,
  current: '2.900 tCO₂e per tonne',
  verdict:
    'This figure is 53% away from the average of this installation’s earlier figures (1.900 tCO₂e per tonne). Check it with the supplier before relying on it.',
  rows: [
    { period: '2027-Q1', value: '1.800 tCO₂e per tonne', source: 'Supplier’s figure' },
    { period: '2027-Q2', value: '1.900 tCO₂e per tonne', source: 'Supplier’s figure' },
  ],
}

describe('CbamSupplierHistory', () => {
  it('shows the verdict without a click, and the earlier figures on one', async () => {
    fetchMock.mockReturnValue(answer(flagged))
    render(<CbamSupplierHistory caseId="case-1" goodsLineId="gl-1" />)

    expect(await screen.findByText(/53% away/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cbam/cases/case-1/goods-lines/gl-1/supplier-history')
    expect(screen.queryByText('2027-Q1')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Earlier figures (2)' }))
    expect(screen.getByText('2027-Q1')).toBeInTheDocument()
    expect(screen.getAllByText('1.800 tCO₂e per tonne')).toHaveLength(1)
  })

  it('offers nothing to open when there are no earlier figures', async () => {
    fetchMock.mockReturnValue(
      answer({
        available: true,
        flagged: false,
        current: '1.9',
        verdict: 'This is the first figure from this installation for these goods.',
        rows: [],
      }),
    )
    render(<CbamSupplierHistory caseId="case-1" goodsLineId="gl-1" />)
    expect(await screen.findByText(/first figure/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says quietly when the history could not be loaded', async () => {
    fetchMock.mockReturnValue(answer({ error: 'down' }, 502))
    render(<CbamSupplierHistory caseId="case-1" goodsLineId="gl-1" />)
    expect(await screen.findByText('Supplier history could not be loaded just now.')).toBeInTheDocument()
  })
})
