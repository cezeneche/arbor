/**
 * Writing a case's audit narrative. Only a writer, only on the caller's own
 * case, and each refusal from Nucleos answered with its own status.
 */

const writer = { user: { id: 'user-1', entityId: 'ent-1', role: 'CONTRIBUTOR' } }
jest.mock('@/lib/auth-helpers', () => ({
  requireWriteAccess: jest.fn(async () => ({ session: writer, response: null })),
}))

const access = jest.fn()
jest.mock('@/lib/nucleos/case-ownership', () => ({
  resolveCaseAccess: (...a: unknown[]) => access(...a),
}))
const getCase = jest.fn()
jest.mock('@/lib/nucleos/cases-client', () => ({ getCbamCase: (id: string) => getCase(id) }))

const write = jest.fn()
jest.mock('@/lib/layer2/cbam-narrative', () => ({
  writeNarrative: (...a: unknown[]) => write(...a),
  defaultNarrativeDeps: async () => ({}),
}))

import { POST } from '../cases/[caseId]/narrative/route'

const params = { params: Promise.resolve({ caseId: 'case-1' }) }
const post = () => POST(new Request('http://arbor.test', { method: 'POST' }), params)

beforeEach(() => {
  jest.clearAllMocks()
  access.mockResolvedValue({ allowed: true, documentId: 'doc-1' })
  getCase.mockResolvedValue({ importer_eori: 'GB123456789000', reporting_year: 2027, reporting_quarter: 1 })
})

describe('POST narrative', () => {
  it("writes the narrative for the caller's own case, named by its importer and quarter", async () => {
    write.mockResolvedValue({
      ok: true,
      narrativeId: 'nar-1',
      reviewRequired: false,
      emailed: 0,
      emailProblem: null,
    })
    const res = await post()
    expect(res.status).toBe(201)
    expect(access).toHaveBeenCalledWith('case-1', 'ent-1')
    expect(write.mock.calls[0][0]).toEqual({
      entityId: 'ent-1',
      userId: 'user-1',
      caseId: 'case-1',
      caseLabel: 'GB123456789000 · 2027 Q1',
    })
  })

  it('falls back to the case id when the case cannot be read for its name', async () => {
    getCase.mockRejectedValue(new Error('down'))
    write.mockResolvedValue({
      ok: true,
      narrativeId: 'nar-1',
      reviewRequired: false,
      emailed: 0,
      emailProblem: null,
    })
    await post()
    expect(write.mock.calls[0][0].caseLabel).toBe('case case-1')
  })

  it("refuses a case that is not the caller's, before asking Nucleos", async () => {
    access.mockResolvedValue({ allowed: false })
    expect((await post()).status).toBe(404)
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['NOT_ALLOWED', 503],
    ['BLOCKED', 422],
    ['UNAVAILABLE', 502],
  ])('answers %s with %i', async (code, status) => {
    write.mockResolvedValue({ ok: false, code, message: 'm' })
    const res = await post()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'm', code })
  })
})
