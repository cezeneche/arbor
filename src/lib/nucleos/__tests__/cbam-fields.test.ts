import {
  CBAM_GOODS_LINE_FIELDS,
  CBAM_SCALAR_FIELDS,
  cbamCompulsoryFieldsPresent,
  goodsLineFieldName,
  isCbamFieldName,
  isCbamNumericFieldName,
  parseGoodsLineFieldName,
} from '../cbam-fields'

describe('CBAM field names', () => {
  describe('parseGoodsLineFieldName', () => {
    it('splits a goods-line name into its index and field', () => {
      expect(parseGoodsLineFieldName('lines[0].cn_code')).toEqual({
        lineIndex: 0,
        field: 'cn_code',
      })
      expect(parseGoodsLineFieldName('lines[12].direct_embedded_kgco2e')).toEqual({
        lineIndex: 12,
        field: 'direct_embedded_kgco2e',
      })
    })

    it('returns null for anything that is not a goods-line name', () => {
      expect(parseGoodsLineFieldName('importer_name')).toBeNull()
      expect(parseGoodsLineFieldName('lines[].cn_code')).toBeNull()
      expect(parseGoodsLineFieldName('lines[x].cn_code')).toBeNull()
      expect(parseGoodsLineFieldName('')).toBeNull()
    })

    // A field the mapper never emits must not be silently accepted: it would
    // travel into a case payload as an unrecognised key and be dropped there
    // instead, which is a harder place to notice it.
    it('returns null for a goods-line name Nucleos does not produce', () => {
      expect(parseGoodsLineFieldName('lines[0].invented_field')).toBeNull()
    })
  })

  describe('goodsLineFieldName', () => {
    it('round-trips with the parser', () => {
      const name = goodsLineFieldName(3, 'net_mass_kg')
      expect(name).toBe('lines[3].net_mass_kg')
      expect(parseGoodsLineFieldName(name)).toEqual({ lineIndex: 3, field: 'net_mass_kg' })
    })
  })

  describe('isCbamFieldName', () => {
    it('accepts every scalar the extractor emits', () => {
      for (const name of CBAM_SCALAR_FIELDS) {
        expect(isCbamFieldName(name)).toBe(true)
      }
    })

    it('accepts every goods-line field the mapper emits', () => {
      for (const field of CBAM_GOODS_LINE_FIELDS) {
        expect(isCbamFieldName(`lines[0].${field}`)).toBe(true)
      }
    })

    it('rejects a name from another document type', () => {
      expect(isCbamFieldName('total_consumption_kwh')).toBe(false)
    })
  })

  describe('isCbamNumericFieldName', () => {
    // Only these three become DataRecords. A CN code is digits and would parse
    // as a number, which is exactly why the classification is a list and not a
    // guess at the value: storing "72081000" as a quantity in kg would be a
    // record that reads as eighty-two thousand tonnes of nothing.
    it('is true only for the three measured quantities', () => {
      expect(isCbamNumericFieldName('lines[0].net_mass_kg')).toBe(true)
      expect(isCbamNumericFieldName('lines[0].direct_embedded_kgco2e')).toBe(true)
      expect(isCbamNumericFieldName('lines[0].indirect_embedded_kgco2e')).toBe(true)
    })

    it('is false for a CN code, which is digits but not a quantity', () => {
      expect(isCbamNumericFieldName('lines[0].cn_code')).toBe(false)
    })

    it('is false for every scalar', () => {
      for (const name of CBAM_SCALAR_FIELDS) {
        expect(isCbamNumericFieldName(name)).toBe(false)
      }
    })
  })

  describe('cbamCompulsoryFieldsPresent', () => {
    const complete = () =>
      new Map([
        ['importer_eori', 'GB123456789000'],
        ['origin_country', 'IN'],
        ['lines[0].cn_code', '72081000'],
        ['lines[0].net_mass_kg', '24000'],
      ])

    it('is true when the importer, the origin and one full goods line are all there', () => {
      expect(cbamCompulsoryFieldsPresent(complete())).toBe(true)
    })

    it('accepts the importer’s name when no EORI was read', () => {
      const m = complete()
      m.delete('importer_eori')
      m.set('importer_name', 'Midlands Steel Ltd')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(true)
    })

    it('is false with no importer at all', () => {
      const m = complete()
      m.delete('importer_eori')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(false)
    })

    // A 6-digit HS heading carries no sector and no default value. The
    // admissibility spec makes it a critical flag, so it cannot support Tier A.
    it('is false when the only goods line has a 6-digit code', () => {
      const m = complete()
      m.set('lines[0].cn_code', '720810')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(false)
    })

    it('is false when no goods line has a weight', () => {
      const m = complete()
      m.delete('lines[0].net_mass_kg')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(false)
    })

    it('is false when nothing states where the goods came from', () => {
      const m = complete()
      m.delete('origin_country')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(false)
    })

    it('accepts a line-level origin when the document has none', () => {
      const m = complete()
      m.delete('origin_country')
      m.set('lines[0].origin_country', 'TR')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(true)
    })

    // One complete line is enough. A declaration with a good line and a
    // half-read one is still evidenced for the goods it did read.
    it('is true when one line qualifies and another does not', () => {
      const m = complete()
      m.set('lines[1].cn_code', '760110')
      expect(cbamCompulsoryFieldsPresent(m)).toBe(true)
    })

    it('is false for an empty confirmation', () => {
      expect(cbamCompulsoryFieldsPresent(new Map())).toBe(false)
    })
  })
})
