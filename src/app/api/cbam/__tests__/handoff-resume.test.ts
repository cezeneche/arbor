/**
 * Resuming a CBAM handoff: by the user, from the CBAM page, and by the sweep.
 *
 * A handoff that failed or stopped halfway used to be unrecoverable — the only
 * advice was to confirm again, which the confirm route refuses. These routes are
 * the way back, and each one must resume only a handoff the caller owns.
 */

const sessionA = { user: { id: 'user-A', entityId: 'entity-A', role: 'CONTRIBUTOR' } }

jest.mock('@/lib/auth-helpers', () => ({
  requireWriteAccess: jest.fn(async () => ({ session: sessionA, response: null })),
}))

const LINKS = [
  { documentId: 'doc-A', entityId: 'entity-A' },
  { documentId: 'doc-B', entityId: 'entity-B' },
]
const findMany = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    cbamCaseLink: {
      findFirst: jest.fn(async ({ where }: { where: { documentId: string; entityId: string } }) =>
        LINKS.find(l => l.documentId === where.documentId && l.entityId === where.entityId) ?? null,
      ),
      findMany: (args: unknown) => findMany(args),
    },
  },
}))

const runCbamHandoff = jest.fn(async (documentId: string) => ({
  attempted: true,
  caseId: `case-for-${documentId}`,
  status: 'CREATED',
  problems: [],
}))
const supply = jest.fn()
jest.mock('@/lib/layer2/cbam-handoff', () => ({
  runCbamHandoff: (id: string) => runCbamHandoff(id),
  supplyCbamHandoffIdentifiers: (input: unknown) => supply(input),
  SWEEP_MAX_ATTEMPTS: 5,
}))

import { POST as resume } from '../handoffs/[documentId]/resume/route'
import { POST as identifiers } from '../handoffs/[documentId]/identifiers/route'
import { GET as sweep } from '../../cron/cbam-handoffs/route'

const params = (documentId: string) => ({ params: Promise.resolve({ documentId }) })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
})

describe('POST /api/cbam/handoffs/[documentId]/resume', () => {
  it("resumes the caller's own handoff", async () => {
    const res = await resume(new Request('http://arbor.test', { method: 'POST' }), params('doc-A'))
    expect(res.status).toBe(200)
    expect(runCbamHandoff).toHaveBeenCalledWith('doc-A')
    expect(await res.json()).toMatchObject({ caseId: 'case-for-doc-A', status: 'CREATED' })
  })

  it("will not resume another organisation's handoff", async () => {
    const res = await resume(new Request('http://arbor.test', { method: 'POST' }), params('doc-B'))
    expect(res.status).toBe(404)
    expect(runCbamHandoff).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/cbam-handoffs', () => {
  const req = (auth?: string) =>
    new Request('http://arbor.test/api/cron/cbam-handoffs', {
      headers: auth ? { authorization: auth } : {},
    })

  it('refuses a caller without the cron secret', async () => {
    const res = await sweep(req('Bearer wrong') as never)
    expect(res.status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('resumes every unfinished handoff it finds, and reports each outcome', async () => {
    findMany.mockResolvedValue([{ documentId: 'doc-1' }, { documentId: 'doc-2' }])
    const res = await sweep(req('Bearer cron-secret') as never)
    expect(res.status).toBe(200)
    expect(runCbamHandoff.mock.calls.map(c => c[0])).toEqual(['doc-1', 'doc-2'])
    expect(await res.json()).toMatchObject({ resumed: 2, created: 2 })
  })

  it('looks only at unfinished handoffs with input to resume from, under the attempt cap', async () => {
    findMany.mockResolvedValue([])
    await sweep(req('Bearer cron-secret') as never)
    const where = findMany.mock.calls[0][0].where
    expect(where.status).toEqual({ in: ['PENDING', 'FAILED', 'PARTIAL'] })
    expect(where.attempts).toEqual({ lt: 5 })
    expect(where.handoffInput).toEqual({ not: expect.anything() })
  })

  it('keeps going when one resume throws', async () => {
    findMany.mockResolvedValue([{ documentId: 'doc-1' }, { documentId: 'doc-2' }])
    runCbamHandoff.mockRejectedValueOnce(new Error('db down'))
    const res = await sweep(req('Bearer cron-secret') as never)
    expect(runCbamHandoff).toHaveBeenCalledTimes(2)
    expect(await res.json()).toMatchObject({ resumed: 2, errors: 1 })
  })
})

// A handoff waiting for an identifier the document did not give. The route only
// carries the request to supplyCbamHandoffIdentifiers, which decides; what it
// must get right is whose request it is and what the answer means.
describe('POST /api/cbam/handoffs/[documentId]/identifiers', () => {
  const post = (body: unknown) =>
    identifiers(
      new Request('http://arbor.test', { method: 'POST', body: JSON.stringify(body) }),
      params('doc-A'),
    )
  const eori = { fields: [{ fieldName: 'importer_eori', value: 'GB123456789000' }] }

  it("supplies them as the caller's organisation and user", async () => {
    supply.mockResolvedValue({ ok: true, outcome: { caseId: 'case-1', status: 'CREATED', problems: [] } })
    const res = await post(eori)
    expect(res.status).toBe(200)
    expect(supply).toHaveBeenCalledWith({
      documentId: 'doc-A',
      entityId: 'entity-A',
      userId: 'user-A',
      amendments: eori.fields,
    })
    expect(await res.json()).toMatchObject({ caseId: 'case-1', status: 'CREATED' })
  })

  it('refuses a malformed body without supplying anything', async () => {
    const res = await post({ fields: 'GB123' })
    expect(res.status).toBe(400)
    expect(supply).not.toHaveBeenCalled()
  })

  it('answers 404 for a handoff the caller does not own', async () => {
    supply.mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'none' })
    expect((await post(eori)).status).toBe(404)
  })

  it('answers 409 for a handoff that is not waiting', async () => {
    supply.mockResolvedValue({ ok: false, code: 'NOT_WAITING', message: 'not waiting' })
    expect((await post(eori)).status).toBe(409)
  })

  it('names the values it could not use', async () => {
    supply.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: 'Some of these could not be used.',
      errors: [{ fieldName: 'importer_eori', message: 'bad' }],
    })
    const res = await post(eori)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ fields: [{ fieldName: 'importer_eori', message: 'bad' }] })
  })
})
