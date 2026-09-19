/**
 * Two organisations, one Nucleos service token.
 *
 * Nucleos sees every Arbor organisation as the same tenant, so these routes are
 * the only thing standing between organisation A and organisation B's CBAM
 * cases. Each test puts A's session against B's case (or a case nobody owns)
 * and checks the request is refused before anything reaches Nucleos.
 */

const LINKS = [
  { entityId: 'entity-A', documentId: 'doc-A', nucleosCaseId: 'case-A' },
  { entityId: 'entity-B', documentId: 'doc-B', nucleosCaseId: 'case-B' },
]

const CASES: Record<string, Record<string, unknown>> = {
  'case-A': { id: 'case-A', jurisdiction: 'UK', goods_lines: [{ id: 'line-A1' }] },
  'case-B': { id: 'case-B', jurisdiction: 'UK', goods_lines: [{ id: 'line-B1' }] },
  'legacy-case': { id: 'legacy-case', jurisdiction: 'UK', goods_lines: [{ id: 'line-L1' }] },
}

const sessionA = { user: { id: 'user-A', entityId: 'entity-A', role: 'CONTRIBUTOR' } }

jest.mock('@/lib/auth-helpers', () => ({
  requireAuth: jest.fn(async () => ({ session: sessionA, response: null })),
  requireWriteAccess: jest.fn(async () => ({ session: sessionA, response: null })),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    cbamCaseLink: {
      findFirst: jest.fn(async ({ where }: { where: { nucleosCaseId: string; entityId: string } }) => {
        const hit = LINKS.find(
          l => l.nucleosCaseId === where.nucleosCaseId && l.entityId === where.entityId,
        )
        return hit ? { documentId: hit.documentId } : null
      }),
      findMany: jest.fn(async () => []),
    },
    dataRecord: { findFirst: jest.fn(async () => ({ trustTier: 'A' })) },
  },
}))

const getCbamCase = jest.fn(async (id: string) => {
  if (!CASES[id]) throw new Error('not found')
  return CASES[id]
})
jest.mock('@/lib/nucleos/cases-client', () => ({
  getCbamCase: (id: string) => getCbamCase(id),
}))

const createSupplierToken = jest.fn(async (lineId: string) => ({
  form_url: `https://arbor.test/supplier/${lineId}`,
  expires_at: null,
}))
jest.mock('@/lib/nucleos/supplier-request-client', () => ({
  createSupplierToken: (id: string) => createSupplierToken(id),
  SupplierRequestRejectedError: class extends Error {},
}))

const calculateDeclaration = jest.fn(async () => ({}))
jest.mock('@/lib/nucleos/calculate-client', () => ({
  calculateDeclaration: () => calculateDeclaration(),
}))

const buildHmrcReturn = jest.fn(async () => ({ body: '{}', contentType: 'application/json', fileName: 'r.json' }))
jest.mock('@/lib/nucleos/return-client', () => ({
  buildHmrcReturn: () => buildHmrcReturn(),
  buildEuXmlDeclaration: jest.fn(),
  ReturnNotAvailableError: class extends Error {},
}))

import { GET as getCase } from '../cases/[caseId]/route'
import { GET as calculate } from '../cases/[caseId]/calculate/route'
import { POST as buildReturn } from '../cases/[caseId]/return/route'
import { POST as supplierToken } from '../supplier-token/route'
import { POST as cprClaim } from '../cpr-claims/route'

const params = (caseId: string) => ({ params: Promise.resolve({ caseId }) })
const post = (body: unknown) =>
  new Request('http://arbor.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

let fetchSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NUCLEOS_URL = 'https://nucleos.test'
  process.env.NUCLEOS_INTERNAL_TOKEN = 'service-token'
  fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ id: 'claim-1' }), { status: 201 }))
})

afterEach(() => fetchSpy.mockRestore())

describe('GET /api/cbam/cases/[caseId]', () => {
  it("returns the caller's own case", async () => {
    const res = await getCase(new Request('http://arbor.test'), params('case-A'))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('case-A')
  })

  it("does not return another organisation's case, and never asks Nucleos for it", async () => {
    const res = await getCase(new Request('http://arbor.test'), params('case-B'))
    expect(res.status).toBe(404)
    expect(getCbamCase).not.toHaveBeenCalled()
  })

  it('does not return a case with no owner on record', async () => {
    const res = await getCase(new Request('http://arbor.test'), params('legacy-case'))
    expect(res.status).toBe(404)
    expect(getCbamCase).not.toHaveBeenCalled()
  })
})

describe('GET /api/cbam/cases/[caseId]/calculate', () => {
  it("refuses another organisation's case before reading it", async () => {
    const res = await calculate(new Request('http://arbor.test'), params('case-B'))
    expect(res.status).toBe(404)
    expect(getCbamCase).not.toHaveBeenCalled()
    expect(calculateDeclaration).not.toHaveBeenCalled()
  })

  it('refuses a case with no owner on record', async () => {
    const res = await calculate(new Request('http://arbor.test'), params('legacy-case'))
    expect(res.status).toBe(404)
    expect(getCbamCase).not.toHaveBeenCalled()
  })
})

describe('POST /api/cbam/cases/[caseId]/return', () => {
  const body = { format: 'HMRC_RETURN', importerVatNumber: 'GB1', accuracyDeclaration: true }

  it("refuses another organisation's case", async () => {
    const res = await buildReturn(post(body) as never, params('case-B'))
    expect(res.status).toBe(404)
    expect(buildHmrcReturn).not.toHaveBeenCalled()
  })

  it('refuses a case with no owner on record', async () => {
    const res = await buildReturn(post(body) as never, params('legacy-case'))
    expect(res.status).toBe(404)
    expect(buildHmrcReturn).not.toHaveBeenCalled()
  })

  it("builds the caller's own return", async () => {
    const res = await buildReturn(post(body) as never, params('case-A'))
    expect(res.status).toBe(200)
    expect(buildHmrcReturn).toHaveBeenCalled()
  })
})

describe('POST /api/cbam/supplier-token', () => {
  it('requires the case the goods line is on', async () => {
    const res = await supplierToken(post({ goods_line_id: 'line-A1' }))
    expect(res.status).toBe(400)
    expect(createSupplierToken).not.toHaveBeenCalled()
  })

  it("will not issue a supplier link for another organisation's goods line", async () => {
    const res = await supplierToken(post({ case_id: 'case-B', goods_line_id: 'line-B1' }))
    expect(res.status).toBe(404)
    expect(createSupplierToken).not.toHaveBeenCalled()
  })

  it("will not issue one for a foreign line smuggled in under the caller's own case", async () => {
    const res = await supplierToken(post({ case_id: 'case-A', goods_line_id: 'line-B1' }))
    expect(res.status).toBe(404)
    expect(createSupplierToken).not.toHaveBeenCalled()
  })

  it('issues one for a line on the caller’s own case', async () => {
    const res = await supplierToken(post({ case_id: 'case-A', goods_line_id: 'line-A1' }))
    expect(res.status).toBe(200)
    expect(createSupplierToken).toHaveBeenCalledWith('line-A1')
  })
})

describe('POST /api/cbam/cpr-claims', () => {
  const claim = { goods_line_id: 'line-A1', verified_emissions_tco2e: 1 }

  it('requires the case the goods line is on', async () => {
    const res = await cprClaim(post(claim))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("will not record a claim against another organisation's goods line", async () => {
    const res = await cprClaim(post({ ...claim, case_id: 'case-B', goods_line_id: 'line-B1' }))
    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("will not record one for a foreign line under the caller's own case", async () => {
    const res = await cprClaim(post({ ...claim, case_id: 'case-A', goods_line_id: 'line-B1' }))
    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("records a claim on the caller's own line, without passing the case id to Nucleos", async () => {
    const res = await cprClaim(post({ ...claim, case_id: 'case-A' }))
    expect(res.status).toBe(201)
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(sent).toEqual(claim)
  })
})
