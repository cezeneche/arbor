import { isRecordProducingField, splitConfirmFields } from '../confirm-split'

describe('isRecordProducingField', () => {
  it('is true for the measured fields of an ordinary document', () => {
    expect(isRecordProducingField('total_consumption_kwh')).toBe(true)
    expect(isRecordProducingField('declared_weight')).toBe(true)
  })

  it('is true for a CBAM goods line’s mass and embedded emissions', () => {
    expect(isRecordProducingField('lines[0].net_mass_kg')).toBe(true)
    expect(isRecordProducingField('lines[2].direct_embedded_kgco2e')).toBe(true)
  })

  // These are identifiers, not measurements. A record needs a value, a unit and
  // a period; an EORI has none of the three, and a CN code that parsed as a
  // number would be stored as a quantity of something.
  it('is false for identifiers, however numeric they look', () => {
    expect(isRecordProducingField('importer_eori')).toBe(false)
    expect(isRecordProducingField('lines[0].cn_code')).toBe(false)
    expect(isRecordProducingField('origin_country')).toBe(false)
  })
})

describe('splitConfirmFields', () => {
  const fields = [
    { fieldName: 'lines[0].net_mass_kg', value: '24000' },
    { fieldName: 'importer_eori', value: 'GB123456789000' },
    { fieldName: 'lines[0].cn_code', value: '72081000' },
    { fieldName: 'lines[0].direct_embedded_kgco2e', value: '43200' },
  ]

  it('puts measurements in records and everything else in context', () => {
    const { records, context } = splitConfirmFields(fields)
    expect(records.map(f => f.fieldName)).toEqual([
      'lines[0].net_mass_kg',
      'lines[0].direct_embedded_kgco2e',
    ])
    expect(context.map(f => f.fieldName)).toEqual(['importer_eori', 'lines[0].cn_code'])
  })

  it('keeps every field — nothing is dropped by the split', () => {
    const { records, context } = splitConfirmFields(fields)
    expect(records.length + context.length).toBe(fields.length)
  })

  it('handles a document with no measurements at all', () => {
    const { records, context } = splitConfirmFields([{ fieldName: 'importer_eori', value: 'X' }])
    expect(records).toEqual([])
    expect(context).toHaveLength(1)
  })
})
