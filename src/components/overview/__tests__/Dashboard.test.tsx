/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { Dashboard } from '../Dashboard'
import { AssignFlag, DashboardViewSwitch } from '../DashboardControls'
import { buildDashboard } from '@/lib/layer3/dashboard'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
jest.mock('../Dashboard.module.css', () => ({}))

const now = new Date('2026-10-14T12:00:00Z')
const model = buildDashboard({
  now,
  userId: 'alex',
  documents: [
    {
      id: 'bill',
      fileName: 'September.pdf',
      domain: 'ENERGY',
      status: 'REVIEW_REQUIRED',
      autoAccepted: false,
      submittedById: 'alex',
      submittedByName: 'Alex',
      submittedAt: now,
    },
  ],
  records: [],
  requests: [],
  flags: [],
  stewards: [],
  inbound: [],
  handoffs: [],
})
const data: ComponentProps<typeof Dashboard>['data'] = {
  ...model,
  entity: { legalName: 'Example company', entityType: 'SUPPLIER', cbamEnabled: false },
  members: [{ id: 'alex', name: 'Alex' }],
  domains: [],
  recent: [],
  processingCount: 0,
  grantCount: 0,
  shares: [],
  reviewCount: 1,
  caseCount: 0,
  unfinishedCases: 0,
  showCbam: false,
}
const props = { data, query: '', results: [], now, canAssign: true, canWrite: true }

beforeEach(() => jest.clearAllMocks())

it('puts the exact document review first even with an empty repository', () => {
  render(<Dashboard {...props} view="work" />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My work')
  expect(screen.getByRole('link', { name: 'Review values →' })).toHaveAttribute('href', '/upload/bill/review')
  expect(screen.queryByText(/more records/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Your intervention' })).not.toBeInTheDocument()
})

it('gives the organisation its own decision hierarchy', () => {
  render(<Dashboard {...props} view="organisation" />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Organisation overview')
  expect(screen.getByRole('heading', { name: 'Your intervention' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Access and dependencies' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Start here' })).not.toBeInTheDocument()
})

it('keeps search scoped to the current dashboard view', () => {
  render(
    <Dashboard
      {...props}
      view="organisation"
      query="energy"
      results={[
        { id: 'r', title: 'Energy', kind: 'Stored record', detail: 'Verified', href: '/records?record=r' },
      ]}
    />,
  )
  expect(screen.getByRole('search')).toHaveAttribute('action', '/dashboard')
  expect(screen.getByRole('search').querySelector('input[name="view"]')).toHaveValue('organisation')
  expect(screen.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/records?record=r')
})

it('switches views without discarding the search', () => {
  render(<DashboardViewSwitch view="work" query="energy" />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Dashboard view' }), {
    target: { value: 'organisation' },
  })
  expect(push).toHaveBeenCalledWith('/dashboard?view=organisation&q=energy')
})

it('offers no upload action to a read-only account', () => {
  render(<Dashboard {...props} view="work" canWrite={false} canAssign={false} />)
  expect(screen.queryByRole('link', { name: '+ Add documents' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open details →' })).toBeInTheDocument()
})

it('persists ownership through the protected endpoint and refreshes the live dashboard', async () => {
  const originalFetch = global.fetch
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ assigneeId: 'alex', assigneeName: 'Alex' }) })
  global.fetch = fetchMock
  try {
    render(<AssignFlag flagId="flag" ownerId={null} members={[{ id: 'alex', name: 'Alex' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Assign an owner →' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Responsible person' }), {
      target: { value: 'alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save owner' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/flags/flag/assign',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ userId: 'alex' }) }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Assigned to Alex.')
  } finally {
    global.fetch = originalFetch
  }
})
