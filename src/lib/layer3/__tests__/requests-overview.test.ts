import { categoriseRequests } from '@/lib/layer3/requests-overview'

// Layer 3, read-only. Fuses three sources the supplier sees as one idea —
// "someone wants my data, and here's what I've given" — into two sections.
// Waiting on you  = incoming data requests not yet answered + email requests needing data.
// What you've shared = shared links + answered requests (both channels).
// Outgoing data requests (a buyer asking suppliers) are a third, separate question.

const base = {
  dataRequests: [] as Parameters<typeof categoriseRequests>[0]['dataRequests'],
  inboundRequests: [] as Parameters<typeof categoriseRequests>[0]['inboundRequests'],
  sharedExports: [] as Parameters<typeof categoriseRequests>[0]['sharedExports'],
}

function dr(p: Partial<(typeof base.dataRequests)[number]>) {
  return { id: 'd1', status: 'PENDING', direction: 'incoming', counterpartyName: 'Acme', domain: 'ENERGY', periodStart: '2026-01-01', periodEnd: '2026-03-31', deadline: null, createdAt: '2026-02-01T00:00:00Z', ...p } as (typeof base.dataRequests)[number]
}
function ib(p: Partial<(typeof base.inboundRequests)[number]>) {
  return { id: 'e1', status: 'NEEDS_DATA', fromEmail: 'buyer@acme.com', createdAt: '2026-02-01T00:00:00Z', answeredAt: null, ...p } as (typeof base.inboundRequests)[number]
}
function se(p: Partial<(typeof base.sharedExports)[number]>) {
  return { id: 's1', domain: 'ENERGY', state: 'active', createdAt: '2026-02-01T00:00:00Z', ...p } as (typeof base.sharedExports)[number]
}

describe('categoriseRequests', () => {
  it('returns empty sections for no input', () => {
    const r = categoriseRequests(base)
    expect(r.waiting).toHaveLength(0)
    expect(r.shared).toHaveLength(0)
    expect(r.sent).toHaveLength(0)
  })

  it('routes incoming data requests by status', () => {
    const r = categoriseRequests({
      ...base,
      dataRequests: [
        dr({ id: 'a', status: 'PENDING' }),
        dr({ id: 'b', status: 'QUERY_RAISED' }),
        dr({ id: 'c', status: 'SUBMITTED' }),
        dr({ id: 'd', status: 'ACCEPTED' }),
      ],
    })
    expect(r.waiting.map(i => i.id).sort()).toEqual(['a', 'b'])
    expect(r.shared.map(i => i.id).sort()).toEqual(['c', 'd'])
  })

  it('puts outgoing data requests in their own "sent" section', () => {
    const r = categoriseRequests({ ...base, dataRequests: [dr({ id: 'o', direction: 'outgoing', status: 'PENDING' })] })
    expect(r.sent.map(i => i.id)).toEqual(['o'])
    expect(r.waiting).toHaveLength(0)
  })

  it('routes email requests: needs-data waits, answered is shared', () => {
    const r = categoriseRequests({
      ...base,
      inboundRequests: [ib({ id: 'n', status: 'NEEDS_DATA' }), ib({ id: 'w', status: 'NEW' }), ib({ id: 'a', status: 'ANSWERED', answeredAt: '2026-03-01' })],
    })
    expect(r.waiting.map(i => i.id).sort()).toEqual(['n', 'w'])
    expect(r.shared.map(i => i.id)).toEqual(['a'])
  })

  it('always lists shared links under what you have shared, tagged as links', () => {
    const r = categoriseRequests({ ...base, sharedExports: [se({ id: 'x', state: 'revoked' })] })
    expect(r.shared).toHaveLength(1)
    expect(r.shared[0].source).toBe('shared-link')
  })

  it('sorts each section newest first', () => {
    const r = categoriseRequests({
      ...base,
      sharedExports: [se({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }), se({ id: 'new', createdAt: '2026-05-01T00:00:00Z' })],
    })
    expect(r.shared.map(i => i.id)).toEqual(['new', 'old'])
  })
})
