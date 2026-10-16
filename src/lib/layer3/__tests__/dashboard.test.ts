import { buildDashboard, requestCoverage, type DashboardInput } from '../dashboard'

const now = new Date('2026-10-13T10:00:00Z')
const start = new Date('2026-07-01')
const end = new Date('2026-09-30')
const request = {
  id: 'request',
  direction: 'incoming' as const,
  counterparty: 'Acme',
  domain: 'ENERGY',
  periodStart: start,
  periodEnd: end,
  requiredFields: ['consumption'],
  deadline: new Date('2026-10-14'),
  status: 'PENDING',
  requestedById: 'buyer-user',
  requestedByName: 'Buyer',
}
const record = {
  id: 'record',
  domain: 'ENERGY',
  fieldName: 'consumption',
  periodStart: start,
  periodEnd: end,
  trustTier: 'A',
  staleAfterDate: null,
  critical: false,
}
const input = (overrides: Partial<DashboardInput> = {}): DashboardInput => ({
  now,
  userId: 'alex',
  documents: [],
  requests: [],
  records: [],
  flags: [],
  stewards: [],
  inbound: [],
  handoffs: [],
  ...overrides,
})

describe('dashboard decisions', () => {
  it('keeps colleagues’ supplier dependencies out of the personal waiting list', () => {
    const model = buildDashboard(
      input({
        requests: [
          { ...request, id: 'mine', direction: 'outgoing', requestedById: 'alex' },
          { ...request, id: 'colleague', direction: 'outgoing', requestedById: 'priya' },
          { ...request, id: 'shared', status: 'SUBMITTED' },
        ],
      }),
    )
    expect(model.personalWaiting.map(task => task.id)).toEqual(['request-mine', 'request-shared'])
    expect(model.commitments).toHaveLength(3)
  })
  it('does not call a quarter complete when only one month is present', () => {
    expect(requestCoverage(request, [{ ...record, periodEnd: new Date('2026-07-31') }], now).ready).toBe(
      false,
    )
  })

  it('joins consecutive record periods and counts each required field once', () => {
    const records = [
      { ...record, periodEnd: new Date('2026-07-31') },
      { ...record, id: 'aug', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-08-31') },
      { ...record, id: 'sep', periodStart: new Date('2026-09-01') },
    ]
    expect(
      requestCoverage({ ...request, requiredFields: ['consumption', 'consumption'] }, records, now),
    ).toMatchObject({ ready: true, requested: 1, covered: 1, missing: [] })
  })

  it('withholds readiness for critical flags, expired records and unspecified requirements', () => {
    expect(requestCoverage(request, [{ ...record, critical: true }], now).ready).toBe(false)
    expect(requestCoverage(request, [{ ...record, staleAfterDate: new Date('2026-10-01') }], now).ready).toBe(
      false,
    )
    expect(requestCoverage({ ...request, requiredFields: [] }, [record], now).ready).toBe(false)
  })

  it('does not use the buyer’s own records to claim its supplier has responded', () => {
    const model = buildDashboard(
      input({ requests: [{ ...request, direction: 'outgoing' }], records: [record] }),
    )
    expect(model.commitments[0].status).toBe('Waiting on supplier')
    expect(model.commitments[0].ready).toBe(false)
    expect(model.waiting).toHaveLength(1)
    expect(model.tasks).toHaveLength(0)
  })

  it('shows review work even when there are no stored records', () => {
    const model = buildDashboard(
      input({
        documents: [
          {
            id: 'doc',
            fileName: 'Bill.pdf',
            domain: 'ENERGY',
            status: 'REVIEW_REQUIRED',
            autoAccepted: false,
            submittedById: 'alex',
            submittedByName: 'Alex',
            submittedAt: now,
          },
        ],
      }),
    )
    expect(model.tasks[0]).toMatchObject({ href: '/upload/doc/review', kind: 'review' })
  })

  it('keeps another person’s task out of My work, but visible to the organisation', () => {
    const flag = {
      id: 'flag',
      recordId: 'record',
      domain: 'ENERGY',
      fieldName: 'consumption',
      message: 'Check source',
      severity: 'CRITICAL',
      assigneeId: 'priya',
      assigneeName: 'Priya',
      dueAt: now,
    }
    const model = buildDashboard(input({ flags: [flag] }))
    expect(model.tasks).toHaveLength(0)
    expect(model.interventions[0].owner).toBe('Priya')
    expect(
      buildDashboard(input({ flags: [{ ...flag, assigneeId: 'alex', assigneeName: 'Alex' }] })).tasks,
    ).toHaveLength(1)
  })

  it('labels unassigned work as shared and never uses the requesting buyer as its internal owner', () => {
    const model = buildDashboard(input({ requests: [request], records: [record] }))
    expect(model.tasks[0].owner).toBe('Shared team queue')
    expect(model.commitments[0].owner).toBe('No data steward')
    expect(model.commitments[0].ready).toBe(true)
  })

  it('links a document review to the matching request without claiming it covers a period', () => {
    const model = buildDashboard(
      input({
        requests: [request],
        documents: [
          {
            id: 'doc',
            fileName: 'Bill.pdf',
            domain: 'ENERGY',
            status: 'REVIEW_REQUIRED',
            autoAccepted: false,
            submittedById: 'alex',
            submittedByName: 'Alex',
            submittedAt: now,
          },
        ],
      }),
    )
    expect(model.tasks[0].kind).toBe('review')
    expect(model.tasks[0].detail).toContain('Acme')
    expect(model.commitments[0].ready).toBe(false)
  })

  it('keeps auto-accepted documents in the review queue and describes them as already stored', () => {
    const model = buildDashboard(
      input({
        documents: [
          {
            id: 'doc',
            fileName: 'Bill.pdf',
            domain: 'ENERGY',
            status: 'ACCEPTED',
            autoAccepted: true,
            submittedById: 'alex',
            submittedByName: 'Alex',
            submittedAt: now,
          },
        ],
      }),
    )
    expect(model.tasks[0].detail).toContain('Stored as Declared')
  })

  it('shows CBAM handoff failures without inventing a filing deadline or return readiness', () => {
    const model = buildDashboard(
      input({
        handoffs: [
          {
            id: 'link',
            documentId: 'doc',
            fileName: 'Customs.pdf',
            submittedById: 'alex',
            submittedByName: 'Alex',
            status: 'FAILED',
            caseId: null,
          },
        ],
      }),
    )
    expect(model.tasks[0]).toMatchObject({ kind: 'cbam', deadline: null, href: '/cbam?view=cases' })
    expect(model.commitments).toHaveLength(0)
  })
})
