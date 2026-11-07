import { decideEntityLink, type EntityLinkStore } from '../decide'

// A person settles a proposed match. The decision is terminal: a link can be
// confirmed or rejected only while it is PENDING. The check and the write are
// one conditional update, so two operators deciding the same pair at once
// cannot both win.

function store(status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | null) {
  const calls: unknown[] = []
  const db: EntityLinkStore = {
    entityLink: {
      updateMany: async args => {
        calls.push(args)
        return { count: status === 'PENDING' ? 1 : 0 }
      },
      findUnique: async () => (status === null ? null : { status }),
    },
  }
  return { db, calls }
}

const NOW = new Date('2026-11-07T12:00:00Z')

it('confirms a pending match and records who decided', async () => {
  const { db, calls } = store('PENDING')
  const result = await decideEntityLink(db, { id: 'l1', action: 'confirm', userId: 'u1', now: NOW })
  expect(result).toEqual({ ok: true, status: 'CONFIRMED' })
  expect(calls).toEqual([
    {
      where: { id: 'l1', status: 'PENDING' },
      data: { status: 'CONFIRMED', reviewedById: 'u1', reviewedAt: NOW },
    },
  ])
})

it('rejects a pending match', async () => {
  const { db } = store('PENDING')
  const result = await decideEntityLink(db, { id: 'l1', action: 'reject', userId: 'u1', now: NOW })
  expect(result).toEqual({ ok: true, status: 'REJECTED' })
})

it('refuses a match that was already decided', async () => {
  const { db } = store('CONFIRMED')
  const result = await decideEntityLink(db, { id: 'l1', action: 'reject', userId: 'u1', now: NOW })
  expect(result).toEqual({ ok: false, reason: 'ALREADY_REVIEWED' })
})

it('reports a match that does not exist', async () => {
  const { db } = store(null)
  const result = await decideEntityLink(db, { id: 'nope', action: 'confirm', userId: 'u1', now: NOW })
  expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
})
