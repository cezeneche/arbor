import { NextRequest, NextResponse } from 'next/server'

// POST /api/flags/[id]/resolve — a supplier keeps a flagged value with a note,
// or corrects it. The rules live in Layer 2 (resolveFlag); the route checks who
// is asking, reads the body, and tells buyers after a correction commits.

const auth = jest.fn()
const resolve = jest.fn()
const notifyBuyers = jest.fn()
const tellBuyer = jest.fn()
const captureLabel = jest.fn()
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
jest.mock('@/lib/dispute-answer', () => ({ tellDisputingBuyer: (...a: unknown[]) => tellBuyer(...a) }))
jest.mock('@/lib/confidence/correction-label', () => ({
  captureCorrectionLabel: (...a: unknown[]) => captureLabel(...a),
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
const BEFORE = {
  id: 'rec-1',
  fieldName: 'electricity_kwh',
  domain: 'ENERGY',
  documentId: 'doc-1',
  extractionMethod: 'DOCUMENT_AI',
  ...Q3,
}
const KEPT = { ok: true, action: 'kept', before: BEFORE, disputedBy: null }
const CORRECTED = { ok: true, action: 'corrected', recordId: 'rec-new', before: BEFORE, disputedBy: null }

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({
    session: { user: { id: 'u1', entityId: 'org', role: 'CONTRIBUTOR' } },
    response: null,
  })
  resolve.mockResolvedValue(KEPT)
  notifyBuyers.mockResolvedValue(undefined)
  tellBuyer.mockResolvedValue(true)
  captureLabel.mockResolvedValue(true)
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
  resolve.mockResolvedValue(CORRECTED)
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
  resolve.mockResolvedValue({ ...CORRECTED, disputedBy: 'buyer-1' })
  notifyBuyers.mockRejectedValue(new Error('mail down'))
  tellBuyer.mockRejectedValue(new Error('mail down'))
  captureLabel.mockRejectedValue(new Error('db blip'))
  jest.spyOn(console, 'error').mockImplementation(() => {})
  expect((await call({ action: 'correct', value: 1 })).status).toBe(200)
})

it('tells the buyer who disputed the value that the supplier kept it, with the note', async () => {
  resolve.mockResolvedValue({ ...KEPT, disputedBy: 'buyer-1' })
  await call({ action: 'keep', note: '  Checked against the meter.  ' })
  expect(tellBuyer).toHaveBeenCalledWith({
    supplierEntityId: 'org',
    buyerEntityId: 'buyer-1',
    record: BEFORE,
    outcome: 'kept',
    note: 'Checked against the meter.',
  })
})

it('tells the disputing buyer about a correction too', async () => {
  resolve.mockResolvedValue({ ...CORRECTED, disputedBy: 'buyer-1' })
  await call({ action: 'correct', value: 44900 })
  expect(tellBuyer).toHaveBeenCalledWith(
    expect.objectContaining({ buyerEntityId: 'buyer-1', outcome: 'corrected' }),
  )
})

it('tells no buyer when nobody disputed it', async () => {
  await call({ action: 'keep', note: 'Checked.' })
  expect(tellBuyer).not.toHaveBeenCalled()
})

it('learns from a correction of a value the model read', async () => {
  resolve.mockResolvedValue(CORRECTED)
  await call({ action: 'correct', value: '44,900' })
  expect(captureLabel).toHaveBeenCalledWith(expect.anything(), {
    entityId: 'org',
    documentId: 'doc-1',
    fieldName: 'electricity_kwh',
    domain: 'ENERGY',
    newRecordId: 'rec-new',
    correctedValue: 44900,
  })
})

it('learns nothing from correcting a value a person typed, or from keeping one', async () => {
  resolve.mockResolvedValue({ ...CORRECTED, before: { ...BEFORE, extractionMethod: 'MANUAL_ENTRY' } })
  await call({ action: 'correct', value: 1 })
  resolve.mockResolvedValue(KEPT)
  await call({ action: 'keep', note: 'Checked.' })
  expect(captureLabel).not.toHaveBeenCalled()
})
