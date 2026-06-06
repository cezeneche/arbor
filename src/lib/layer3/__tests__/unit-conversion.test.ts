import { normaliseToSI, convertFromSI, isSupportedUnit } from '../unit-conversion'

describe('normaliseToSI — ingestion path', () => {
  describe('energy', () => {
    it('kWh → MJ: 1 kWh = 3.6 MJ (SI definition)', () => {
      const r = normaliseToSI(1, 'kwh')
      expect(r.siUnit).toBe('mj')
      expect(r.value).toBe(3.6)
    })
    it('GJ → MJ (× 1000)', () => {
      const r = normaliseToSI(1, 'gj')
      expect(r.siUnit).toBe('mj')
      expect(r.value).toBe(1000)
    })
    it('therm (UK) → MJ: 1 therm = 105.505585 MJ', () => {
      const r = normaliseToSI(1, 'therms')
      expect(r.siUnit).toBe('mj')
      expect(r.value).toBeCloseTo(105.505585, 6)
    })
    it('toe → MJ: 1 toe = 41868 MJ', () => {
      const r = normaliseToSI(1, 'toe')
      expect(r.siUnit).toBe('mj')
      expect(r.value).toBe(41868)
    })
    it('BTU → MJ', () => {
      const r = normaliseToSI(1, 'btu')
      expect(r.siUnit).toBe('mj')
      expect(r.value).toBeCloseTo(0.00105506, 6)
    })
    it('kcal → MJ: 1 kcal = 0.004184 MJ', () => {
      const r = normaliseToSI(1, 'kcal')
      expect(r.siUnit).toBe('mj')
      expect(r.value).toBeCloseTo(0.004184, 6)
    })
  })

  describe('mass', () => {
    it('tonnes → kg: 1 tonne = 1000 kg (exact)', () => {
      const r = normaliseToSI(2, 'tonnes')
      expect(r.siUnit).toBe('kg')
      expect(r.value).toBe(2000)
    })
    it('g → kg: 1000 g = 1 kg', () => {
      const r = normaliseToSI(1000, 'g')
      expect(r.siUnit).toBe('kg')
      expect(r.value).toBe(1)
    })
    it('lbs → kg', () => {
      const r = normaliseToSI(1, 'lbs')
      expect(r.siUnit).toBe('kg')
      expect(r.value).toBeCloseTo(0.453592, 5)
    })
    it('short ton (US) → kg: 1 = 907.18474 kg', () => {
      const r = normaliseToSI(1, 'short_tons')
      expect(r.siUnit).toBe('kg')
      expect(r.value).toBeCloseTo(907.18474, 5)
    })
    it('long ton → kg: 1 = 1016.0469 kg', () => {
      const r = normaliseToSI(1, 'long_tons')
      expect(r.siUnit).toBe('kg')
      expect(r.value).toBeCloseTo(1016.0469, 4)
    })
    it('oz → kg', () => {
      const r = normaliseToSI(1, 'oz')
      expect(r.siUnit).toBe('kg')
      expect(r.value).toBeCloseTo(0.0283495, 5)
    })
  })

  describe('volume', () => {
    it('litres → m³: 1000 L = 1 m³ (exact)', () => {
      const r = normaliseToSI(1000, 'litres')
      expect(r.siUnit).toBe('m3')
      expect(r.value).toBe(1)
    })
    it('ml → m³', () => {
      const r = normaliseToSI(1000000, 'ml')
      expect(r.siUnit).toBe('m3')
      expect(r.value).toBe(1)
    })
    it('gallons UK → m³', () => {
      const r = normaliseToSI(1, 'gallons_uk')
      expect(r.siUnit).toBe('m3')
      expect(r.value).toBeCloseTo(0.00454609, 7)
    })
    it('gallons US → m³', () => {
      const r = normaliseToSI(1, 'gallons_us')
      expect(r.siUnit).toBe('m3')
      expect(r.value).toBeCloseTo(0.00378541, 7)
    })
    it('barrels → m³', () => {
      const r = normaliseToSI(1, 'barrels')
      expect(r.siUnit).toBe('m3')
      expect(r.value).toBeCloseTo(0.158987, 5)
    })
    it('ft³ → m³', () => {
      const r = normaliseToSI(1, 'ft3')
      expect(r.siUnit).toBe('m3')
      expect(r.value).toBeCloseTo(0.0283168, 6)
    })
  })

  describe('area', () => {
    it('hectares → m²: 1 ha = 10000 m² (exact)', () => {
      const r = normaliseToSI(1, 'hectares')
      expect(r.siUnit).toBe('m2')
      expect(r.value).toBe(10000)
    })
    it('acres → m²', () => {
      const r = normaliseToSI(1, 'acres')
      expect(r.siUnit).toBe('m2')
      expect(r.value).toBeCloseTo(4046.86, 2)
    })
    it('km² → m²', () => {
      const r = normaliseToSI(1, 'km2')
      expect(r.siUnit).toBe('m2')
      expect(r.value).toBe(1000000)
    })
    it('ft² → m²', () => {
      const r = normaliseToSI(1, 'ft2')
      expect(r.siUnit).toBe('m2')
      expect(r.value).toBeCloseTo(0.0929030, 5)
    })
    it('yd² → m²', () => {
      const r = normaliseToSI(1, 'yd2')
      expect(r.siUnit).toBe('m2')
      expect(r.value).toBeCloseTo(0.836127, 5)
    })
  })

  describe('distance', () => {
    it('miles → km: 1 mile = 1.609344 km (exact, international definition)', () => {
      const r = normaliseToSI(1, 'miles')
      expect(r.siUnit).toBe('km')
      expect(r.value).toBe(1.609344)
    })
    it('nautical miles → km (× 1.852)', () => {
      const r = normaliseToSI(10, 'nautical_miles')
      expect(r.siUnit).toBe('km')
      expect(r.value).toBeCloseTo(18.52, 5)
    })
    it('m → km: 1000 m = 1 km', () => {
      const r = normaliseToSI(1000, 'm')
      expect(r.siUnit).toBe('km')
      expect(r.value).toBe(1)
    })
  })

  describe('emissions', () => {
    it('tonnes_co2e → kg_co2e (× 1000)', () => {
      const r = normaliseToSI(1.5, 'tonnes_co2e')
      expect(r.siUnit).toBe('kg_co2e')
      expect(r.value).toBe(1500)
    })
    it('g_co2e → kg_co2e', () => {
      const r = normaliseToSI(1000, 'g_co2e')
      expect(r.siUnit).toBe('kg_co2e')
      expect(r.value).toBeCloseTo(1, 6)
    })
    it('lbs_co2e → kg_co2e', () => {
      const r = normaliseToSI(1, 'lbs_co2e')
      expect(r.siUnit).toBe('kg_co2e')
      expect(r.value).toBeCloseTo(0.453592, 5)
    })
  })
})

describe('convertFromSI — output path', () => {
  it('MJ → kWh: 360 MJ = 100 kWh', () => {
    const r = convertFromSI(360, 'mj', 'kwh')
    expect(r.convertedValue).toBeCloseTo(100, 6)
    expect(r.convertedUnit).toBe('kwh')
    expect(r.originalUnit).toBe('mj')
  })

  it('kg → tonnes: 1000 kg = 1 tonne', () => {
    const r = convertFromSI(1000, 'kg', 'tonnes')
    expect(r.convertedValue).toBeCloseTo(1, 6)
    expect(r.convertedUnit).toBe('tonnes')
  })

  it('m3 → litres: 1 m³ = 1000 L', () => {
    const r = convertFromSI(1, 'm3', 'litres')
    expect(r.convertedValue).toBeCloseTo(1000, 4)
  })

  it('km → miles: 1.609344 km = 1 mile', () => {
    const r = convertFromSI(1.609344, 'km', 'miles')
    expect(r.convertedValue).toBeCloseTo(1, 5)
  })

  it('kg_co2e → tonnes_co2e: 1000 kg = 1 tonne', () => {
    const r = convertFromSI(1000, 'kg_co2e', 'tonnes_co2e')
    expect(r.convertedValue).toBeCloseTo(1, 6)
  })

  it('throws when dimensions are incompatible', () => {
    expect(() => convertFromSI(100, 'mj', 'kg')).toThrow()
  })

  it('result includes conversionFactor for transparency', () => {
    const r = convertFromSI(3600, 'mj', 'kwh')
    expect(r.conversionFactor).toBeCloseTo(1 / 3.6, 8)
  })
})

describe('isSupportedUnit', () => {
  it('returns true for valid units', () => {
    expect(isSupportedUnit('kwh')).toBe(true)
    expect(isSupportedUnit('tonnes')).toBe(true)
    expect(isSupportedUnit('gallons_uk')).toBe(true)
  })

  it('returns false for unrecognised strings', () => {
    expect(isSupportedUnit('fathoms')).toBe(false)
    expect(isSupportedUnit('')).toBe(false)
  })
})
