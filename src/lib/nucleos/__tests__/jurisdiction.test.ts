import {
  CBAM_JURISDICTIONS,
  availableReturns,
  calculationRegimes,
  describeJurisdiction,
  extractionJurisdiction,
  isCbamJurisdiction,
  resolveJurisdiction,
} from '../jurisdiction'

describe('CBAM jurisdiction', () => {
  describe('resolveJurisdiction', () => {
    // A stored value is what the user chose. Nothing may quietly substitute one
    // regime for another: the whole point of the setting is that UK and EU
    // produce different outputs from the same document.
    it('returns the stored value unchanged when it is a known jurisdiction', () => {
      expect(resolveJurisdiction('UK')).toBe('UK')
      expect(resolveJurisdiction('EU')).toBe('EU')
      expect(resolveJurisdiction('BOTH')).toBe('BOTH')
    })

    // UK-first product. An entity that has never answered the question is a UK
    // importer filing an HMRC return until it says otherwise — the previous
    // default of EU was wrong for every one of them.
    it('falls back to UK when nothing is stored', () => {
      expect(resolveJurisdiction(null)).toBe('UK')
      expect(resolveJurisdiction(undefined)).toBe('UK')
      expect(resolveJurisdiction('')).toBe('UK')
    })

    it('falls back to UK for an unrecognised value', () => {
      expect(resolveJurisdiction('CH')).toBe('UK')
    })
  })

  describe('extractionJurisdiction', () => {
    // The extraction contract carries only UK | EU, and BOTH has to resolve to
    // one of them. It resolves to EU because EU is the superset: the UK regime
    // excludes indirect emissions and UK-origin precursors, so extracting under
    // UK rules for a dual-exposure importer would drop the very fields the EU
    // return needs. The exclusions are applied later, by the HMRC builder.
    it('maps BOTH to EU, the superset regime', () => {
      expect(extractionJurisdiction('BOTH')).toBe('EU')
    })

    it('passes UK and EU straight through', () => {
      expect(extractionJurisdiction('UK')).toBe('UK')
      expect(extractionJurisdiction('EU')).toBe('EU')
    })
  })

  describe('availableReturns', () => {
    it('offers only the HMRC return under UK', () => {
      expect(availableReturns('UK')).toEqual(['HMRC_RETURN'])
    })

    it('offers only the EU XML under EU', () => {
      expect(availableReturns('EU')).toEqual(['EU_XML'])
    })

    it('offers both under BOTH', () => {
      expect(availableReturns('BOTH')).toEqual(['HMRC_RETURN', 'EU_XML'])
    })
  })

  describe('calculationRegimes', () => {
    it('runs one regime for a single-jurisdiction importer', () => {
      expect(calculationRegimes('UK')).toEqual(['UK'])
      expect(calculationRegimes('EU')).toEqual(['EU'])
    })

    // Unlike extraction, a calculation cannot fold BOTH into one run: the two
    // regimes charge different things, so one figure would understate a return.
    it('runs both regimes for a dual-exposure importer', () => {
      expect(calculationRegimes('BOTH')).toEqual(['UK', 'EU'])
    })
  })

  describe('describeJurisdiction', () => {
    it('describes every jurisdiction in plain English with no regulation codes', () => {
      for (const j of CBAM_JURISDICTIONS) {
        const described = describeJurisdiction(j.id)
        expect(described.label.length).toBeGreaterThan(0)
        expect(described.detail.length).toBeGreaterThan(0)
        // Supplier-facing copy. A citation here would be the domain detail the
        // design rules keep off SME screens.
        expect(described.detail).not.toMatch(/\d{4}\/\d{3,4}/)
      }
    })
  })

  describe('isCbamJurisdiction', () => {
    it('accepts the three known values and nothing else', () => {
      expect(isCbamJurisdiction('UK')).toBe(true)
      expect(isCbamJurisdiction('EU')).toBe(true)
      expect(isCbamJurisdiction('BOTH')).toBe(true)
      expect(isCbamJurisdiction('uk')).toBe(false)
      expect(isCbamJurisdiction('GB')).toBe(false)
      expect(isCbamJurisdiction(null)).toBe(false)
    })
  })
})
