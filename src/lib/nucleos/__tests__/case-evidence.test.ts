import { buildCaseEvidence, type ReadField } from '../case-evidence'

// What Arbor read from a document, as evidence Nucleos can file against the
// case. Keyed to Nucleos's own goods-line ids: a case gathers lines from several
// documents, and "lines[0]" of two of them are different goods.

const read = (over: Partial<ReadField> & { fieldName: string }): ReadField => ({
  extractedValue: null,
  sourceText: 'some text',
  confidence: 0.8,
  ...over,
})

describe('buildCaseEvidence', () => {
  const lineIds = { '0': 'gl-a', '1': 'gl-b' }

  it('keys goods-line fields to the Nucleos goods line and scalars to the case', () => {
    const atoms = buildCaseEvidence({
      readFields: [
        read({ fieldName: 'lines[1].net_mass_kg', extractedValue: '5000', sourceText: 'Net mass | 5 000 kg' }),
        read({ fieldName: 'importer_eori', extractedValue: 'GB123456789000', sourceText: 'EORI: GB123456789000' }),
      ],
      confirmed: { 'lines[1].net_mass_kg': '5000', importer_eori: 'GB123456789000' },
      lineIds,
    })
    expect(atoms).toEqual([
      { field: 'goods_lines.gl-b.net_mass_kg', value: 5000, source: 'arbor_extraction', confidence: 0.8, snippet: 'Net mass | 5 000 kg' },
      { field: 'case.importer_eori', value: 'GB123456789000', source: 'arbor_extraction', confidence: 0.8, snippet: 'EORI: GB123456789000' },
    ])
  })

  // The reviewer's value is the one on the case. The text the extraction read
  // stays with it, so anyone checking can see what the document said.
  it('says when a person corrected the value, and keeps what the document said', () => {
    const [atom] = buildCaseEvidence({
      readFields: [read({ fieldName: 'lines[0].net_mass_kg', extractedValue: '24500', sourceText: 'Net mass | 24 500 kg' })],
      confirmed: { 'lines[0].net_mass_kg': '24000' },
      lineIds,
    })
    expect(atom).toEqual({
      field: 'goods_lines.gl-a.net_mass_kg',
      value: 24000,
      source: 'arbor_reviewer_corrected',
      confidence: 1,
      snippet: 'Net mass | 24 500 kg',
    })
  })

  // "24 500" read and "24500" confirmed are the same figure. Calling that a
  // correction would tell an auditor a person changed a value nobody changed.
  it('does not call a figure corrected when only its formatting differs', () => {
    const [atom] = buildCaseEvidence({
      readFields: [read({ fieldName: 'lines[0].net_mass_kg', extractedValue: '24 500', sourceText: 'Net mass | 24 500 kg' })],
      confirmed: { 'lines[0].net_mass_kg': '24500' },
      lineIds,
    })
    expect(atom.source).toBe('arbor_extraction')
    expect(atom.value).toBe(24500)
  })

  it('leaves out a line that is not on the case yet', () => {
    const atoms = buildCaseEvidence({
      readFields: [read({ fieldName: 'lines[2].net_mass_kg', extractedValue: '1', sourceText: 'x' })],
      confirmed: { 'lines[2].net_mass_kg': '1' },
      lineIds,
    })
    expect(atoms).toEqual([])
  })

  it('leaves out a field with no text behind it, since there is nothing to show', () => {
    expect(
      buildCaseEvidence({
        readFields: [read({ fieldName: 'importer_eori', extractedValue: 'GB1', sourceText: '  ' })],
        confirmed: { importer_eori: 'GB1' },
        lineIds,
      }),
    ).toEqual([])
  })

  it('leaves out fields that are not CBAM fields', () => {
    expect(
      buildCaseEvidence({ readFields: [read({ fieldName: 'supplier_vat', extractedValue: 'X' })], confirmed: {}, lineIds }),
    ).toEqual([])
  })

  it('keeps an identifier as text even when it is all digits', () => {
    const [atom] = buildCaseEvidence({
      readFields: [read({ fieldName: 'lines[0].cn_code', extractedValue: '72081000', sourceText: 'CN 7208 1000' })],
      confirmed: { 'lines[0].cn_code': '72081000' },
      lineIds,
    })
    expect(atom.value).toBe('72081000')
  })

  it('keeps confidence within 0 and 1', () => {
    const [atom] = buildCaseEvidence({
      readFields: [read({ fieldName: 'importer_eori', extractedValue: 'GB1', confidence: 1.4 })],
      confirmed: { importer_eori: 'GB1' },
      lineIds,
    })
    expect(atom.confidence).toBe(1)
  })
})
