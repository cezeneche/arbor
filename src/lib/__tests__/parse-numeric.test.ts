import { parseNumericValue } from '@/lib/parse-numeric'

// Data-integrity guard. Extracted/entered values arrive as strings that may use
// thousands separators ("48,250"). JavaScript's parseFloat stops at the comma
// ("48,250" -> 48), which silently corrupted stored values by up to 1000×.
// parseNumericValue strips thousands separators first, then parses.

describe('parseNumericValue', () => {
  it('strips a thousands separator (the bug that stored 48,250 kWh as 48)', () => {
    expect(parseNumericValue('48,250')).toBe(48250)
  })

  it('strips multiple thousands separators', () => {
    expect(parseNumericValue('1,234,567')).toBe(1234567)
  })

  it('keeps the decimal point while stripping thousands separators', () => {
    expect(parseNumericValue('1,234.56')).toBe(1234.56)
  })

  it('parses plain integers and decimals unchanged', () => {
    expect(parseNumericValue('24500')).toBe(24500)
    expect(parseNumericValue('3.14')).toBe(3.14)
  })

  it('tolerates a trailing unit (as parseFloat did)', () => {
    expect(parseNumericValue('24500 kg')).toBe(24500)
    expect(parseNumericValue('48,250 kWh')).toBe(48250)
  })

  it('trims surrounding whitespace', () => {
    expect(parseNumericValue('  100  ')).toBe(100)
  })

  it('returns null for empty / null / non-numeric input', () => {
    expect(parseNumericValue('')).toBeNull()
    expect(parseNumericValue('   ')).toBeNull()
    expect(parseNumericValue(null)).toBeNull()
    expect(parseNumericValue(undefined)).toBeNull()
    expect(parseNumericValue('n/a')).toBeNull()
  })

  it('does not strip a comma that is not a thousands separator', () => {
    // "1,5" (two digits after the comma) is ambiguous; we do not treat it as a
    // thousands group, so it parses as parseFloat would (1). Documented behaviour.
    expect(parseNumericValue('1,5')).toBe(1)
  })
})
