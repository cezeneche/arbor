/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlaggedRecords } from '../FlaggedRecords'
import type { FlaggedRecordItem } from '@/lib/review/flagged-records'

// The second list on Review. Each flagged record has three ways out, all inline:
// correct the value (the primary action), keep it with a note, or upload a
// corrected document. A critical flag has no "keep" — it needs fixing.

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const fetchMock = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ action: 'corrected' }) })
})

function item(over: Partial<FlaggedRecordItem> = {}): FlaggedRecordItem {
  return {
    flagId: 'flag-1',
    title: 'Electricity used',
    period: 'Jul 2026 – Sep 2026',
    value: '41,200',
    unit: 'kWh',
    message: 'Two documents disagree.',
    canKeep: true,
    mustFix: false,
    overdue: false,
    ...over,
  }
}

it('shows the record, the problem, and the three ways to settle it', () => {
  render(<FlaggedRecords initial={[item()]} />)
  expect(screen.getByText('Electricity used')).toBeInTheDocument()
  expect(screen.getByText('Two documents disagree.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Correct it' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Keep this value' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Upload a corrected document' })).toHaveAttribute('href', '/upload')
})

it('offers no note for a flag that must be fixed', () => {
  render(<FlaggedRecords initial={[item({ canKeep: false, mustFix: true })]} />)
  expect(screen.queryByRole('button', { name: 'Keep this value' })).not.toBeInTheDocument()
  expect(screen.getByText(/needs fixing/i)).toBeInTheDocument()
})

it('saves a correction and takes the record off the list', async () => {
  render(<FlaggedRecords initial={[item()]} />)
  await userEvent.click(screen.getByRole('button', { name: 'Correct it' }))
  const input = screen.getByLabelText('Corrected value')
  await userEvent.clear(input)
  await userEvent.type(input, '44,900')
  await userEvent.click(screen.getByRole('button', { name: 'Save correction' }))

  expect(fetchMock).toHaveBeenCalledWith('/api/flags/flag-1/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'correct', value: '44,900' }),
  })
  expect(screen.queryByText('Two documents disagree.')).not.toBeInTheDocument()
  expect(screen.getByText(/marked Declared/)).toBeInTheDocument()
  expect(refresh).toHaveBeenCalled()
})

it('keeps a value with a note', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ action: 'kept' }) })
  render(<FlaggedRecords initial={[item()]} />)
  await userEvent.click(screen.getByRole('button', { name: 'Keep this value' }))
  await userEvent.type(screen.getByLabelText('Why this value is right'), 'The meter was replaced in August.')
  await userEvent.click(screen.getByRole('button', { name: 'Save note' }))

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/flags/flag-1/resolve',
    expect.objectContaining({
      body: JSON.stringify({ action: 'keep', note: 'The meter was replaced in August.' }),
    }),
  )
  expect(screen.queryByText('Two documents disagree.')).not.toBeInTheDocument()
})

it('says why a save was refused and keeps the record on the list', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'That is the value already saved. Change it, or keep it with a note.' }),
  })
  render(<FlaggedRecords initial={[item()]} />)
  await userEvent.click(screen.getByRole('button', { name: 'Correct it' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save correction' }))
  expect(
    screen.getByText('That is the value already saved. Change it, or keep it with a note.'),
  ).toBeInTheDocument()
  expect(screen.getByText('Two documents disagree.')).toBeInTheDocument()
})

it('renders nothing when no record needs a decision', () => {
  const { container } = render(<FlaggedRecords initial={[]} />)
  expect(container).toBeEmptyDOMElement()
})
