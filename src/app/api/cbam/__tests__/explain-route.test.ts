/**
 * "Why this number?" for one goods-line figure. Only the caller's own goods
 * line, only the figures the panel offers, and a plain answer when Nucleos has
 * nothing recorded.
 */

const reader = { user: { id: 'user-1', entityId: 'ent-1', role: 'VIEWER' } }
jest.mock('@/lib/auth-helpers', () => ({
  requireAuth: jest.fn(async () => ({ session: reader, response: null })),
}))

const access = jest.fn()
jest.mock('@/lib/nucleos/goods-line-access', () => ({
  resolveGoodsLineAccess: (...a: unknown[]) => access(...a),
}))

const explain = jest.fn()
jest.mock('@/lib/nucleos/explain-client', () => ({
  explainGoodsLineField: (...a: unknown[]) => explain(...a),
}))

import { GET } from '../cases/[caseId]/goods-lines/[goodsLineId]/explain/route'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'

const params = { params: Promise.resolve({ caseId: 'case-1', goodsLineId: 'gl-1' }) }
const req = (field: string) => new Request(`http://arbor.test/x?field=${encodeURIComponent(field)}`)

beforeEach(() => {
  jest.clearAllMocks()
  access.mockResolvedValue({ ok: true })
})

describe('GET explain', () => {
  it('shows where the figure came from', async () => {
    explain.mockResolvedValue({
      chosen_value: 5000,
      evidence: [
        {
          field: 'goods_lines.gl-1.net_mass_kg',
          source: 'arbor_extraction',
          confidence: 0.9,
          snippet: 'Net 5 000 kg',
          source_ref: 'arbor:document:doc-1',
        },
      ],
    })
    const res = await GET(req('net_mass_kg'), params)
    expect(res.status).toBe(200)
    expect(access).toHaveBeenCalledWith('case-1', 'gl-1', 'ent-1')
    expect(explain).toHaveBeenCalledWith('case-1', 'gl-1', 'net_mass_kg')
    expect(await res.json()).toEqual({
      available: true,
      sources: [
        {
          text: 'Net 5 000 kg',
          how: 'Read from the document (90% sure).',
          documentHref: '/upload/doc-1/review',
        },
      ],
    })
  })

  it('answers plainly when nothing was recorded', async () => {
    explain.mockResolvedValue(null)
    const res = await GET(req('net_mass_kg'), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: false, sources: [] })
  })

  it('refuses a field the panel does not offer', async () => {
    const res = await GET(req('case.importer_eori'), params)
    expect(res.status).toBe(400)
    expect(explain).not.toHaveBeenCalled()
  })

  it('refuses a goods line the caller does not own, before asking Nucleos', async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: 'This goods line could not be found.' })
    const res = await GET(req('net_mass_kg'), params)
    expect(res.status).toBe(404)
    expect(explain).not.toHaveBeenCalled()
  })

  it('says when Nucleos cannot be reached', async () => {
    explain.mockRejectedValue(new NucleosUnavailableError('down'))
    const res = await GET(req('net_mass_kg'), params)
    expect(res.status).toBe(502)
  })
})
