import { countryName } from '../country-name'

// Goods lines carry an ISO country code ("TR"), which the CBAM screens printed
// as it was: "Goods from TR are not covered…". Importers read names, not codes.

describe('countryName', () => {
  it('names a country from its ISO code', () => {
    expect(countryName('CN')).toBe('China')
    expect(countryName('IN')).toBe('India')
    expect(countryName('DE')).toBe('Germany')
  })

  it('says Turkey, as GOV.UK and HMRC do', () => {
    // CLDR now says "Türkiye"; UK government pages and HMRC's rate files say Turkey.
    expect(countryName('TR')).toBe('Turkey')
  })

  it('reads a lower-case or padded code', () => {
    expect(countryName(' tr ')).toBe('Turkey')
  })

  it('keeps anything it cannot name as it was, never "Unknown Region"', () => {
    expect(countryName('ZZ')).toBe('ZZ')
    expect(countryName('XYZ')).toBe('XYZ')
    expect(countryName('')).toBe('')
  })
})
