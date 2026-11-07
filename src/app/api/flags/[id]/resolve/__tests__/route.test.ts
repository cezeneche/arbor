import { NextRequest, NextResponse } from 'next/server'

// POST /api/flags/[id]/resolve — a supplier keeps a flagged value with a note,
// or corrects it. The rules live in Layer 2 (resolveFlag); the route checks who
// is asking, reads the body, and tells buyers after a correction commits.

const auth = jest.fn()
const resolve = jest.fn()
const notifyBuyers = jest.fn()
jest.mock('@/lib/auth-helpers', () => ({ requireWriteAccess: () => auth() }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/layer2/serializable', () => ({
  runSerializable: (fn: (tx: unknown) => unknown) => fn('tx'),
}))
jest.mock('@/lib/layer2/flag-resolution', () => ({
  MAX_NOTE_LENGTH: 1000,
  resolveFlag: (...a: unknown[]) => resolve(...a),
}))
jest.mock('@/lib/supersession-notice', () => ({
  notifyBuyersOfSupersession: (...a: unknown[]) => notifyBuyers(...a),
}))
import { POST } from '../route'

const call = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/flags/flag-1/resolve', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'flag-1' }) },
  )

const Q3 = { periodStart: new Date('2026-07-01T00:00:00Z'), periodEnd: new Date('2026-09-30T00:00:00Z') }

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({
    session: { user: { id: 'u1', entityId: 'org', role: 'CONTRIBUTOR' } },
    response: null,
  })
  resolve.mockResolvedValue({ ok: true, action: 'kept' })
  notifyBuyers.mockResolvedValue(undefined)
})

it('refuses a read-only member before touching anything', async () => {
  auth.mockResolvedValue({
    session: null,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  })
  expect((await call({ action: 'keep', note: 'Checked.' })).status).toBe(403)
  expect(resolve).not.toHaveBeenCalled()
})

it('keeps a value for the caller’s own organisation', async () => {
  const res = await call({ action: 'keep', note: 'The meter was replaced.' })
  expect(res.status).toBe(200)
  expect(resolve).toHaveBeenCalledWith('tx', {
    flagId: 'flag-1',
    entityId: 'org',
    userId: 'u1',
    request: { action: 'keep', note: 'The meter was replaced.' },
    now: expect.any(Date),
  })
  expect(notifyBuyers).not.toHaveBeenCalled()
})

it('reads a typed correction the way a person writes it', async () => {
  resolve.mockResolvedValue({
    ok: true,
    action: 'corrected',
    recordId: 'rec-new',
    scope: { domain: 'ENERGY', ...Q3 },
  })
  const res = await call({ action: 'correct', value: '44,900' })
  expect(res.status).toBe(200)
  expect(resolve.mock.calls[0][1].request).toEqual({ action: 'correct', value: 44900 })
  expect(notifyBuyers).toHaveBeenCalledWith('org', [{ domain: 'ENERGY', ...Q3 }])
})

it('refuses a correction that is not a number', async () => {
  expect((await call({ action: 'correct', value: 'about forty thousand' })).status).toBe(400)
  expect(resolve).not.toHaveBeenCalled()
})

it('refuses an unknown action', async () => {
  expect((await call({ action: 'delete' })).status).toBe(400)
})

it('reports a flag that is not the caller’s, or no longer open, as not found', async () => {
  resolve.mockResolvedValue({ ok: false, reason: 'NOT_FOUND' })
  expect((await call({ action: 'keep', note: 'x' })).status).toBe(404)
})

it('explains why a critical flag needs a correction or a document', async () => {
  resolve.mockResolvedValue({ ok: false, reason: 'NEEDS_EVIDENCE' })
  const res = await call({ action: 'keep', note: 'Fine.' })
  expect(res.status).toBe(422)
  expect((await res.json()).code).toBe('NEEDS_EVIDENCE')
})

it('still succeeds when telling buyers fails, since the correction is saved', async () => {
  resolve.mockResolvedValue({
    ok: true,
    action: 'corrected',
    recordId: 'rec-new',
    scope: { domain: 'ENERGY', ...Q3 },
  })
  notifyBuyers.mockRejectedValue(new Error('mail down'))
  jest.spyOn(console, 'error').mockImplementation(() => {})
  expect((await call({ action: 'correct', value: 1 })).status).toBe(200)
})
