/**
 * Recording the published default on a goods line: the caller's own line, with
 * no figure yet. Any regime: Nucleos stores the Annex VI value, the UK return
 * uses it as it is, and the EU declaration adds the year's mark-up.
 */

const writer = { user: { id: 'user-1', entityId: 'ent-1', role: 'ADMIN' } }
const requireWriteAccess = jest.fn(async () => ({ session: writer, response: null }))
jest.mock('@/lib/auth-helpers', () => ({ requireWriteAccess: () => requireWriteAccess() }))

const access = jest.fn()
jest.mock('@/lib/nucleos/goods-line-access', () => ({
  resolveGoodsLineAccess: (...a: unknown[]) => access(...a),
}))

const apply = jest.fn()
jest.mock('@/lib/nucleos/apply-default-client', () => {
  const actual = jest.requireActual('@/lib/nucleos/apply-default-client')
  return { ...actual, applyPublishedDefault: (...a: unknown[]) => apply(...a) }
})

import { POST } from '../cases/[caseId]/goods-lines/[goodsLineId]/default/route'
import { DefaultAlreadyRecordedError, NoPublishedDefaultError } from '@/lib/nucleos/apply-default-client'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'

const params = { params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1' }) }
const post = () => POST(new Request('http://arbor.test', { method: 'POST' }), params)

function line(over: Record<string, unknown> = {}) {
  return {
    id: 'gl-1',
    cn_code: '72083900',
    production_route: null,
    direct_kgco2e: null,
    indirect_kgco2e: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  access.mockResolvedValue({ ok: true, line: line() })
  apply.mockResolvedValue(undefined)
})

describe('POST published default', () => {
  it('records the default on the caller’s own line', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(access).toHaveBeenCalledWith('case-1', 'gl-1', 'ent-1')
    expect(apply).toHaveBeenCalledWith('gl-1', null)
  })

  it('refuses a line the caller does not own, before asking Nucleos', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'This goods line could not be found.' })
    expect((await post()).status).toBe(404)
    expect(apply).not.toHaveBeenCalled()
  })

  // Expected: refused. Reason: a supplier's figure, or a partial one, is never
  // replaced by the default from here.
  it.each([{ direct_kgco2e: 1000 }, { indirect_kgco2e: 50 }, { method: 'actual' }])(
    'refuses a line that already has a figure: %o',
    async over => {
      access.mockResolvedValue({ ok: true, line: line(over) })
      expect((await post()).status).toBe(409)
      expect(apply).not.toHaveBeenCalled()
    },
  )

  it('says when the figure was recorded meanwhile', async () => {
    apply.mockRejectedValue(new DefaultAlreadyRecordedError())
    expect((await post()).status).toBe(409)
  })

  it('says when no default is published for the goods', async () => {
    apply.mockRejectedValue(new NoPublishedDefaultError())
    const res = await post()
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/no published default/i)
  })

  it('says when Nucleos cannot be reached', async () => {
    apply.mockRejectedValue(new NucleosUnavailableError('down'))
    expect((await post()).status).toBe(502)
  })
})
