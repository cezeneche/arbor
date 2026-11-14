// A goods line named by the browser is accepted only on a case the caller owns.
// The check already reads the case, so it hands back the line it found and the
// case: the relief screen needs the line's origin, the published-default route
// the case's regime, and asking Nucleos twice is waste.

const allowed = jest.fn()
jest.mock('../case-ownership', () => ({
  resolveCaseAccess: (...a: unknown[]) => allowed(...a),
  goodsLineBelongsToCase: jest.requireActual('../case-ownership').goodsLineBelongsToCase,
}))
const getCase = jest.fn()
jest.mock('../cases-client', () => ({ getCbamCase: (id: string) => getCase(id) }))

import { resolveGoodsLineAccess } from '../goods-line-access'

beforeEach(() => {
  jest.clearAllMocks()
  allowed.mockResolvedValue({ allowed: true })
  getCase.mockResolvedValue({ goods_lines: [{ id: 'gl-1', origin_country: 'DE' }, { id: 'gl-2' }] })
})

it('hands back the line it found, and the case it read', async () => {
  const result = await resolveGoodsLineAccess('case-1', 'gl-1', 'ent-1')
  expect(result).toMatchObject({ ok: true, line: { id: 'gl-1', origin_country: 'DE' } })
  // The case too: the published-default route needs its regime, and asking
  // Nucleos twice is waste.
  expect(result.ok && result.record).toBe(await getCase.mock.results[0].value)
})

it('refuses a line that is not on the case', async () => {
  await expect(resolveGoodsLineAccess('case-1', 'gl-9', 'ent-1')).resolves.toMatchObject({
    ok: false,
    status: 404,
  })
})

it("refuses a case that is not the caller's, before reading it", async () => {
  allowed.mockResolvedValue({ allowed: false })
  await expect(resolveGoodsLineAccess('case-1', 'gl-1', 'ent-1')).resolves.toMatchObject({
    ok: false,
    status: 404,
  })
  expect(getCase).not.toHaveBeenCalled()
})
