/**
 * @jest-environment jsdom
 */

// "Why this number?" opens inline under a figure and shows the words on the
// document it was read from. It asks nothing until opened, and a default-value
// figure has no document text, so it says why instead of asking.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import { CbamWhyThisNumber } from '../CbamWhyThisNumber'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

function answer(body: unknown, status = 200) {
  // jsdom has no Response; the component only reads ok and json().
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
}

describe('CbamWhyThisNumber', () => {
  it('shows the document text, how it was read, and a link to the document', async () => {
    fetchMock.mockReturnValue(
      answer({
        available: true,
        sources: [{ text: 'Net mass | 24 000 kg', how: 'Read from the document (92% sure).', documentHref: '/upload/doc-1/review' }],
      }),
    )
    render(<CbamWhyThisNumber caseId="case-1" goodsLineId="gl-1" figures={[{ field: 'net_mass_kg' }]} />)
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Why this number?' }))

    expect(await screen.findByText('Net mass | 24 000 kg')).toBeInTheDocument()
    expect(screen.getByText(/92% sure/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View document' })).toHaveAttribute('href', '/upload/doc-1/review')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cbam/cases/case-1/goods-lines/gl-1/explain?field=net_mass_kg')
  })

  it('says plainly when nothing was recorded', async () => {
    fetchMock.mockReturnValue(answer({ available: false, sources: [] }))
    render(<CbamWhyThisNumber caseId="case-1" goodsLineId="gl-1" figures={[{ field: 'net_mass_kg' }]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Why this number?' }))
    expect(await screen.findByText(/No document text was recorded/)).toBeInTheDocument()
  })

  it('explains a default figure without asking for document text', async () => {
    render(
      <CbamWhyThisNumber
        caseId="case-1"
        goodsLineId="gl-1"
        figures={[{ field: 'direct_embedded_kgco2e' }]}
        defaultNote="This is the published default."
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Why this number?' }))
    expect(screen.getByText('This is the published default.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers a retry when the service cannot be reached', async () => {
    fetchMock.mockReturnValueOnce(answer({ error: 'The CBAM service could not be reached.' }, 502))
    render(<CbamWhyThisNumber caseId="case-1" goodsLineId="gl-1" figures={[{ field: 'net_mass_kg' }]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Why this number?' }))
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
