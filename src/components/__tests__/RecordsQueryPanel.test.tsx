/**
 * @jest-environment jsdom
 */

// The query box never showed a result for any question.
//
// The endpoint was fine the whole time — it answered with 200 and a full
// payload. The client read `json.data`, but `ok()` sends the payload
// unwrapped, so `json.data` was always undefined, `result` stayed falsy, and
// the panel sat in its idle state no matter what came back.
//
// This test drives the component the way a user does — type, submit, read —
// against the response shape the route actually returns. It fails against the
// `json.data` version.

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import { RecordsQueryPanel } from '../RecordsQueryPanel'

// Exactly what `ok()` puts on the wire: the payload, with no envelope.
const API_RESPONSE = {
  interpretation: 'All energy records for this company',
  answer: 'Arbor holds one electricity record of 1,284,500 kWh, marked Verified.',
  isCalculation: false,
  queryType: 'entity',
  summary: 'Found 1 energy record.',
  recordCount: 1,
  hasMore: false,
  tierDistribution: { A: 1, B: 0, C: 0 },
  records: [
    {
      id: 'rec_1',
      entityName: 'Redditch Steel',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      value: 1284500,
      unit: 'kWh',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-03-31T00:00:00.000Z',
      trustTier: 'A',
      confidenceScore: 0.97,
      sourceText: null,
    },
  ],
}

function mockFetch(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch
}

async function askAQuestion() {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Open query panel'))
  await user.type(screen.getByRole('textbox'), 'What energy records do we have?')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  return user
}

describe('RecordsQueryPanel', () => {
  afterEach(() => jest.resetAllMocks())

  it('shows the answer the endpoint returned', async () => {
    mockFetch(API_RESPONSE)
    render(<RecordsQueryPanel suggestions={[]}>content</RecordsQueryPanel>)
    await askAQuestion()

    await waitFor(() =>
      expect(screen.getByText(/1,284,500 kWh, marked Verified/)).toBeInTheDocument(),
    )
  })

  it('shows the matching records underneath the answer', async () => {
    mockFetch(API_RESPONSE)
    render(<RecordsQueryPanel suggestions={[]}>content</RecordsQueryPanel>)
    await askAQuestion()

    await waitFor(() => expect(screen.getByText('total consumption kwh')).toBeInTheDocument())
    expect(screen.getByText('Found 1 energy record.')).toBeInTheDocument()
  })

  it('leaves the idle prompt behind once an answer arrives', async () => {
    mockFetch(API_RESPONSE)
    render(<RecordsQueryPanel suggestions={[]}>content</RecordsQueryPanel>)
    await askAQuestion()

    await waitFor(() =>
      expect(screen.queryByText(/Ask about your own data in your own words/)).not.toBeInTheDocument(),
    )
  })

  it('says so plainly when the query matched nothing', async () => {
    mockFetch({ ...API_RESPONSE, records: [], recordCount: 0, summary: 'No records found for this query.' })
    render(<RecordsQueryPanel suggestions={[]}>content</RecordsQueryPanel>)
    await askAQuestion()

    await waitFor(() => expect(screen.getByText(/No records matched this query/)).toBeInTheDocument())
  })

  it('surfaces the endpoint error rather than failing silently', async () => {
    mockFetch({ error: 'Rate limit exceeded. Slow down and try again shortly.' }, false)
    render(<RecordsQueryPanel suggestions={[]}>content</RecordsQueryPanel>)
    await askAQuestion()

    await waitFor(() => expect(screen.getByText(/Rate limit exceeded/)).toBeInTheDocument())
  })

  it('offers the suggestions it was given', async () => {
    mockFetch(API_RESPONSE)
    render(
      <RecordsQueryPanel suggestions={['Show me our energy records for 2026']}>content</RecordsQueryPanel>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Open query panel'))
    expect(screen.getByRole('button', { name: 'Show me our energy records for 2026' })).toBeInTheDocument()
  })
})
