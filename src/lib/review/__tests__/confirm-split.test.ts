import { isRecordProducingField, splitConfirmFields, clearedFieldEntries } from '../confirm-split'

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

// The confirm route certifies the extraction with the reviewer's values laid
// over it, so a field left out of the request keeps its extracted value. Both
// review screens sent only fields that still had a value, which made clearing a
// compulsory field a no-op: the value reappeared at certification and the
// document was saved Verified. A clear has to be sent as a clear.
describe('clearedFieldEntries', () => {
  const fields = [
    { fieldName: 'meter_reference', rawValue: 'MPAN 12 3456 7890' },
    { fieldName: 'supplier_name', rawValue: 'Octopus Energy' },
    { fieldName: 'tariff_name', rawValue: null },
    { fieldName: 'total_consumption_kwh', rawValue: '12400' },
  ]

  it('sends an explicit empty value for each field the reviewer cleared', () => {
    expect(
      clearedFieldEntries(fields, {
        meter_reference: '',
        supplier_name: 'Octopus Energy',
        tariff_name: '',
        total_consumption_kwh: '  ',
      }),
    ).toEqual([
      { fieldName: 'meter_reference', confirmedValue: '' },
      { fieldName: 'total_consumption_kwh', confirmedValue: '' },
    ])
  })

  it('does not report a field the extraction never found', () => {
    expect(clearedFieldEntries(fields, { tariff_name: '' })).toEqual([])
  })

  it('does not report a field the screen never showed', () => {
    // No entry in values means the reviewer had no way to clear it.
    expect(clearedFieldEntries(fields, {})).toEqual([])
  })
})
