/**
 * A goods line's supplier history. Read-only; only the caller's own goods line.
 */

const reader = { user: { id: 'user-1', entityId: 'ent-1', role: 'VIEWER' } }
jest.mock('@/lib/auth-helpers', () => ({
  requireAuth: jest.fn(async () => ({ session: reader, response: null })),
}))

const access = jest.fn()
jest.mock('@/lib/nucleos/goods-line-access', () => ({
  resolveGoodsLineAccess: (...a: unknown[]) => access(...a),
}))

const history = jest.fn()
jest.mock('@/lib/nucleos/supplier-history-client', () => ({
  getSupplierHistory: (...a: unknown[]) => history(...a),
}))

import { GET } from '../cases/[caseId]/goods-lines/[goodsLineId]/supplier-history/route'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'

const params = { params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  access.mockResolvedValue({ ok: true, line: { id: 'gl-1' } })
})

describe('GET supplier history', () => {
  it('says whether the figure is in line with the installation’s earlier ones', async () => {
    history.mockResolvedValue({ current_see_tco2e_per_t: '1.9', min_history: 3, history: [], note: null })
    const res = await GET(new Request('http://arbor.test'), params)
    expect(res.status).toBe(200)
    expect(access).toHaveBeenCalledWith('case-1', 'gl-1', 'ent-1')
    expect(history).toHaveBeenCalledWith('gl-1')
    expect(await res.json()).toMatchObject({
      available: true,
      verdict: 'This is the first figure from this installation for these goods.',
    })
  })

  it('refuses a goods line the caller does not own, before asking Nucleos', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'This goods line could not be found.' })
    expect((await GET(new Request('http://arbor.test'), params)).status).toBe(404)
    expect(history).not.toHaveBeenCalled()
  })

  it('says when Nucleos cannot be reached', async () => {
    history.mockRejectedValue(new NucleosUnavailableError('down'))
    expect((await GET(new Request('http://arbor.test'), params)).status).toBe(502)
  })
})
