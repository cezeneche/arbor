import { parseLimit, parsePage } from '../pagination'

// Page and limit come from the query string. `Math.max(1, parseInt(x))` lets
// NaN through (Math.max with NaN is NaN), and NaN became Prisma's `skip`
// (code review R3). Anything unreadable now means the default.

describe('parsePage', () => {
  it('reads a whole page number', () => {
    expect(parsePage('3')).toBe(3)
  })

  it.each([undefined, null, '', 'abc', 'NaN', '-2', '0', '1.5', '2abc', 'Infinity', '1e3'])(
    'falls back to page 1 for %p',
    raw => {
      expect(parsePage(raw)).toBe(1)
    },
  )

  it('caps absurd page numbers so skip stays a safe integer', () => {
    expect(parsePage('99999999999999999999')).toBe(1)
  })
})

describe('parseLimit', () => {
  const opts = { fallback: 50, max: 100 }

  it('reads a limit within range', () => {
    expect(parseLimit('20', opts)).toBe(20)
  })

  it('caps it at the maximum', () => {
    expect(parseLimit('500', opts)).toBe(100)
  })

  it.each([undefined, null, '', 'abc', '0', '-5', '2.5'])('falls back to the default for %p', raw => {
    expect(parseLimit(raw, opts)).toBe(50)
  })
})
