import { parsePageParams, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../page-params'

// List APIs read a bounded page, never the whole store.
describe('parsePageParams', () => {
  const p = (q: string) => parsePageParams(new URLSearchParams(q))

  it('defaults to the first page of the default size', () => {
    expect(p('')).toEqual({ ok: true, limit: DEFAULT_PAGE_SIZE, offset: 0 })
  })

  it('takes a limit and offset', () => {
    expect(p('limit=50&offset=100')).toEqual({ ok: true, limit: 50, offset: 100 })
  })

  it('caps the limit', () => {
    expect(p(`limit=${MAX_PAGE_SIZE * 10}`)).toEqual({ ok: true, limit: MAX_PAGE_SIZE, offset: 0 })
  })

  it('refuses a limit or offset that is not a non-negative whole number', () => {
    expect(p('limit=0').ok).toBe(false)
    expect(p('limit=abc').ok).toBe(false)
    expect(p('offset=-1').ok).toBe(false)
    expect(p('offset=1.5').ok).toBe(false)
  })
})
