/**
 * The verifier's-statement routes. The service decides what happens; these
 * must get right whose request it is, which line it is for, and what an answer
 * means. Nothing reaches the service for a goods line the caller does not own.
 */

const writer = { user: { id: 'user-1', entityId: 'ent-1', role: 'CONTRIBUTOR' } }
jest.mock('@/lib/auth-helpers', () => ({
  requireWriteAccess: jest.fn(async () => ({ session: writer, response: null })),
  requireAuth: jest.fn(async () => ({ session: writer, response: null })),
}))

const access = jest.fn()
jest.mock('@/lib/nucleos/goods-line-access', () => ({
  resolveGoodsLineAccess: (...a: unknown[]) => access(...a),
}))

const submit = jest.fn()
const decide = jest.fn()
const sync = jest.fn()
jest.mock('@/lib/layer2/cbam-verification', () => ({
  submitStatement: (...a: unknown[]) => submit(...a),
  decideStatement: (...a: unknown[]) => decide(...a),
  syncStatement: (...a: unknown[]) => sync(...a),
  defaultVerificationDeps: async () => ({}),
}))

const findFirst = jest.fn()
jest.mock('@/lib/prisma', () => ({ prisma: { cbamVerificationStatement: { findFirst: (a: unknown) => findFirst(a) } } }))

const fetchBytes = jest.fn()
jest.mock('@/lib/storage-retrieval', () => ({ fetchDocumentBytes: (p: string) => fetchBytes(p) }))

import { POST as upload } from '../cases/[caseId]/goods-lines/[goodsLineId]/verification/route'
import { POST as decision } from '../cases/[caseId]/goods-lines/[goodsLineId]/verification/[statementId]/decision/route'
import { POST as retry } from '../cases/[caseId]/goods-lines/[goodsLineId]/verification/[statementId]/sync/route'
import { GET as file } from '../cases/[caseId]/goods-lines/[goodsLineId]/verification/[statementId]/file/route'

const lineParams = { params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1' }) }
const stmtParams = { params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1', statementId: 'stmt-1' }) }

function form(): FormData {
  const f = new FormData()
  f.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'statement.pdf', { type: 'application/pdf' }))
  f.set('verifierName', 'Carbon Assurance Ltd')
  f.set('verifierAccreditation', 'UKAS 9876')
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  access.mockResolvedValue({ ok: true })
})

describe('upload', () => {
  it("stores the statement for the caller's own goods line", async () => {
    submit.mockResolvedValue({ ok: true, statementId: 'stmt-1', synced: true, problem: null })
    const res = await upload(new Request('http://arbor.test', { method: 'POST', body: form() }), lineParams)
    expect(res.status).toBe(201)
    expect(access).toHaveBeenCalledWith('case-1', 'gl-1', 'ent-1')
    expect(submit.mock.calls[0][0]).toMatchObject({
      entityId: 'ent-1',
      userId: 'user-1',
      caseId: 'case-1',
      goodsLineId: 'gl-1',
      fileName: 'statement.pdf',
      verifierName: 'Carbon Assurance Ltd',
      verifierAccreditation: 'UKAS 9876',
    })
  })

  it('refuses a goods line the caller does not own, before storing anything', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'This goods line could not be found.' })
    const res = await upload(new Request('http://arbor.test', { method: 'POST', body: form() }), lineParams)
    expect(res.status).toBe(404)
    expect(submit).not.toHaveBeenCalled()
  })

  it('refuses a request with no file', async () => {
    const f = form()
    f.delete('file')
    const res = await upload(new Request('http://arbor.test', { method: 'POST', body: f }), lineParams)
    expect(res.status).toBe(400)
    expect(submit).not.toHaveBeenCalled()
  })

  it('reports a statement that is waiting for a decision as a conflict', async () => {
    submit.mockResolvedValue({ ok: false, code: 'AWAITING_DECISION', message: 'Decide on it first.' })
    const res = await upload(new Request('http://arbor.test', { method: 'POST', body: form() }), lineParams)
    expect(res.status).toBe(409)
  })
})

describe('decision', () => {
  const post = (body: unknown) =>
    decision(new Request('http://arbor.test', { method: 'POST', body: JSON.stringify(body) }), stmtParams)

  it('passes the decision on for the named line', async () => {
    decide.mockResolvedValue({ ok: true })
    const res = await post({ decision: 'reject', reason: 'Wrong installation.' })
    expect(res.status).toBe(200)
    expect(decide.mock.calls[0][0]).toEqual({
      entityId: 'ent-1',
      userId: 'user-1',
      goodsLineId: 'gl-1',
      statementId: 'stmt-1',
      decision: 'reject',
      reason: 'Wrong installation.',
    })
  })

  it('refuses anything but accept or reject', async () => {
    const res = await post({ decision: 'maybe' })
    expect(res.status).toBe(400)
    expect(decide).not.toHaveBeenCalled()
  })

  it('refuses a line the caller does not own', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'no' })
    expect((await post({ decision: 'accept' })).status).toBe(404)
    expect(decide).not.toHaveBeenCalled()
  })
})

describe('retry', () => {
  it('retries only an unsynced statement of this line', async () => {
    findFirst.mockResolvedValue({ id: 'stmt-1' })
    sync.mockResolvedValue({ ok: true })
    const res = await retry(new Request('http://arbor.test', { method: 'POST' }), stmtParams)
    expect(res.status).toBe(200)
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'stmt-1',
      entityId: 'ent-1',
      goodsLineId: 'gl-1',
      syncedAt: null,
    })
  })

  it('answers 404 when there is nothing to retry', async () => {
    findFirst.mockResolvedValue(null)
    expect((await retry(new Request('http://arbor.test', { method: 'POST' }), stmtParams)).status).toBe(404)
  })
})

describe('file', () => {
  it("streams the caller's own statement as a PDF", async () => {
    findFirst.mockResolvedValue({ storagePath: 'ent-1/x.pdf', fileName: 'statement.pdf' })
    fetchBytes.mockResolvedValue(Buffer.from('%PDF-1.4'))
    const res = await file(new Request('http://arbor.test'), stmtParams)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 'stmt-1', entityId: 'ent-1', goodsLineId: 'gl-1' })
  })

  it("does not reveal whether another organisation's statement exists", async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'no' })
    expect((await file(new Request('http://arbor.test'), stmtParams)).status).toBe(404)
    expect(fetchBytes).not.toHaveBeenCalled()
  })
})
