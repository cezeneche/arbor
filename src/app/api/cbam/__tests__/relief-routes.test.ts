/**
 * Carbon price relief on one goods line: what the screen reads, the verifier's
 * statement behind a claim, and the claim itself. Nothing reaches Nucleos for a
 * goods line the caller does not own.
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

const schemes = jest.fn()
const claims = jest.fn()
jest.mock('@/lib/nucleos/relief-client', () => ({
  listQualifyingSchemes: (...a: unknown[]) => schemes(...a),
  listReliefClaims: (...a: unknown[]) => claims(...a),
}))

const submitRelief = jest.fn()
const syncRelief = jest.fn()
jest.mock('@/lib/layer2/cbam-relief-statement', () => ({
  submitReliefStatement: (...a: unknown[]) => submitRelief(...a),
  syncReliefStatement: (...a: unknown[]) => syncRelief(...a),
  defaultReliefStatementDeps: async () => ({}),
}))
const syncEmissions = jest.fn()
jest.mock('@/lib/layer2/cbam-verification', () => ({
  syncStatement: (...a: unknown[]) => syncEmissions(...a),
  defaultVerificationDeps: async () => ({}),
}))

const findMany = jest.fn()
const findFirst = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    cbamVerificationStatement: {
      findMany: (a: unknown) => findMany(a),
      findFirst: (a: unknown) => findFirst(a),
    },
  },
}))

import { GET as relief } from '../cases/[caseId]/goods-lines/[goodsLineId]/relief/route'
import { POST as reliefStatement } from '../cases/[caseId]/goods-lines/[goodsLineId]/relief/statement/route'
import { POST as retry } from '../cases/[caseId]/goods-lines/[goodsLineId]/verification/[statementId]/sync/route'
import { POST as claim } from '../cpr-claims/route'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'

const lineParams = { params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1' }) }
const stmtParams = {
  params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1', statementId: 'stmt-1' }),
}
const HASH = 'a'.repeat(64)

beforeEach(() => {
  jest.clearAllMocks()
  access.mockResolvedValue({ ok: true, line: { id: 'gl-1', origin_country: 'de' } })
  schemes.mockResolvedValue({
    claimable: true,
    warning: null,
    schemes: [{ name: 'EU Emissions Trading System (EU ETS)', status: 'confirmed', currency: 'EUR' }],
  })
  claims.mockResolvedValue([])
  findMany.mockResolvedValue([])
})

describe('GET relief', () => {
  it("offers the schemes for the line's own origin and asks for a claim", async () => {
    const res = await relief(new Request('http://arbor.test'), lineParams)
    expect(res.status).toBe(200)
    expect(access).toHaveBeenCalledWith('case-1', 'gl-1', 'ent-1')
    expect(schemes).toHaveBeenCalledWith('DE')
    const body = await res.json()
    expect(body).toMatchObject({
      origin: 'DE',
      schemes: {
        eligible: true,
        options: [{ name: 'EU Emissions Trading System (EU ETS)', currency: 'EUR' }],
      },
      claims: [],
      next: 'claim',
      retryStatementId: null,
    })
  })

  it("names the caller's own relief statement behind a claim", async () => {
    claims.mockResolvedValue([
      {
        id: 'c-1',
        created_at: '2027-04-20T10:00:00Z',
        cpr_amount_gbp: 100,
        verification_document_hash: HASH,
      },
    ])
    findMany.mockResolvedValue([
      {
        id: 'stmt-1',
        sha256: HASH,
        verifierName: 'V Ltd',
        verifierAccreditation: 'UKAS 1',
        syncedAt: new Date(),
        syncError: null,
      },
    ])
    const body = await (await relief(new Request('http://arbor.test'), lineParams)).json()
    expect(findMany.mock.calls[0][0].where).toEqual({
      entityId: 'ent-1',
      goodsLineId: 'gl-1',
      subject: 'RELIEF',
    })
    expect(body.claims[0].statement).toMatchObject({ attached: true, statementId: 'stmt-1' })
    expect(body.next).toBe('none')
  })

  it('offers a retry when the statement for the waiting claim did not reach Nucleos', async () => {
    claims.mockResolvedValue([
      {
        id: 'c-1',
        created_at: '2027-04-20T10:00:00Z',
        cpr_amount_gbp: 100,
        verification_document_hash: null,
      },
    ])
    findMany.mockResolvedValue([
      {
        id: 'stmt-2',
        sha256: HASH,
        verifierName: 'V',
        verifierAccreditation: 'A',
        syncedAt: null,
        syncError: 'down',
      },
    ])
    const body = await (await relief(new Request('http://arbor.test'), lineParams)).json()
    expect(body).toMatchObject({ next: 'retry', retryStatementId: 'stmt-2', retryProblem: 'down' })
  })

  it('does not ask about schemes for goods with no origin', async () => {
    access.mockResolvedValue({ ok: true, line: { id: 'gl-1' } })
    const body = await (await relief(new Request('http://arbor.test'), lineParams)).json()
    expect(schemes).not.toHaveBeenCalled()
    expect(body.schemes.eligible).toBe(false)
  })

  it('refuses a line the caller does not own, before asking Nucleos', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'This goods line could not be found.' })
    const res = await relief(new Request('http://arbor.test'), lineParams)
    expect(res.status).toBe(404)
    expect(claims).not.toHaveBeenCalled()
  })

  it('says when Nucleos cannot be reached', async () => {
    claims.mockRejectedValue(new NucleosUnavailableError('down'))
    expect((await relief(new Request('http://arbor.test'), lineParams)).status).toBe(502)
  })
})

function form(): FormData {
  const f = new FormData()
  f.set(
    'file',
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'relief.pdf', { type: 'application/pdf' }),
  )
  f.set('verifierName', 'Carbon Assurance Ltd')
  f.set('verifierAccreditation', 'UKAS 9876')
  return f
}

describe('POST relief statement', () => {
  it("stores the statement for the caller's own goods line", async () => {
    submitRelief.mockResolvedValue({ ok: true, statementId: 'stmt-1', synced: true, problem: null })
    const res = await reliefStatement(
      new Request('http://arbor.test', { method: 'POST', body: form() }),
      lineParams,
    )
    expect(res.status).toBe(201)
    expect(submitRelief.mock.calls[0][0]).toMatchObject({
      entityId: 'ent-1',
      userId: 'user-1',
      caseId: 'case-1',
      goodsLineId: 'gl-1',
      verifierName: 'Carbon Assurance Ltd',
      verifierAccreditation: 'UKAS 9876',
    })
  })

  it('refuses when there is no claim waiting for a statement', async () => {
    submitRelief.mockResolvedValue({ ok: false, code: 'REFUSED', message: 'Record the relief claim first.' })
    const res = await reliefStatement(
      new Request('http://arbor.test', { method: 'POST', body: form() }),
      lineParams,
    )
    expect(res.status).toBe(409)
  })

  it('refuses a goods line the caller does not own, before storing anything', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'This goods line could not be found.' })
    const res = await reliefStatement(
      new Request('http://arbor.test', { method: 'POST', body: form() }),
      lineParams,
    )
    expect(res.status).toBe(404)
    expect(submitRelief).not.toHaveBeenCalled()
  })
})

describe('retrying a statement', () => {
  it('sends a relief statement to the relief claim, not to the emissions step', async () => {
    findFirst.mockResolvedValue({ id: 'stmt-1', subject: 'RELIEF', goodsLineId: 'gl-1', sha256: HASH })
    syncRelief.mockResolvedValue({ ok: true })
    expect((await retry(new Request('http://arbor.test', { method: 'POST' }), stmtParams)).status).toBe(200)
    expect(syncRelief).toHaveBeenCalled()
    expect(syncEmissions).not.toHaveBeenCalled()
  })

  it('sends an emissions statement to the emissions step', async () => {
    findFirst.mockResolvedValue({ id: 'stmt-1', subject: 'EMISSIONS', goodsLineId: 'gl-1', sha256: HASH })
    syncEmissions.mockResolvedValue({ ok: true })
    await retry(new Request('http://arbor.test', { method: 'POST' }), stmtParams)
    expect(syncEmissions).toHaveBeenCalled()
    expect(syncRelief).not.toHaveBeenCalled()
  })
})

describe('POST cpr-claims', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    process.env.NUCLEOS_URL = 'https://nucleos.test'
    process.env.NUCLEOS_INTERNAL_TOKEN = 'token'
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  function post(status: number, body: unknown) {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch
    return claim(
      new Request('http://arbor.test', {
        method: 'POST',
        body: JSON.stringify({ case_id: 'case-1', goods_line_id: 'gl-1', qualifying_scheme_name: 'X' }),
      }),
    )
  }

  it("passes on Nucleos's reason when it refuses the claim", async () => {
    const res = await post(422, {
      detail: 'X is not a scheme the UK recognises for relief on goods from DE.',
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('X is not a scheme the UK recognises for relief on goods from DE.')
  })

  it('keeps the general message when the reason is a list of field errors', async () => {
    const res = await post(422, { detail: [{ loc: ['body', 'x'], msg: 'bad' }] })
    expect((await res.json()).error).toBe('These figures do not make a valid claim.')
  })
})
