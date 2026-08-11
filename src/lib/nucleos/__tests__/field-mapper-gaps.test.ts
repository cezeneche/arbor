import { toExtractedFieldRows } from '../field-mapper'
import type { CbamExtractionResult } from '../contract'

// Written from the first real customs declaration to reach production. It
// produced six rows, four of them empty, every one carrying the same flag about
// a seventh field, and a seven-digit CN code that nothing objected to. The
// reviewer's screen said "96% confident" next to four blank boxes.

const base = (over: Partial<CbamExtractionResult> = {}): CbamExtractionResult =>
  ({ fields: [], lines: [], flags: [], ...over }) as CbamExtractionResult

const field = (name: string, value: string | null, confidence: number, source = 'x') => ({
  field_name: name,
  raw_value: value,
  raw_unit: null,
  source_text: source,
  confidence,
  flags: [],
})

describe('a field with no value', () => {
  it('is never presented as confident', () => {
    // 0.96 next to an empty box is the single most misleading thing this screen
    // can show: it invites a reviewer to confirm a value that is not there.
    const rows = toExtractedFieldRows(base({ fields: [field('importer_eori', null, 0.96)] }))
    expect(rows[0].confidenceScore).toBe(0)
  })

  it('treats an empty string the same as a null', () => {
    const rows = toExtractedFieldRows(base({ fields: [field('importer_eori', '   ', 0.96)] }))
    expect(rows[0].confidenceScore).toBe(0)
  })

  it('is still shown, because a missing compulsory field is the point', () => {
    const rows = toExtractedFieldRows(base({ fields: [field('importer_eori', null, 0.96)] }))
    expect(rows).toHaveLength(1)
    expect(rows[0].flagged).toBe(true)
  })

  it('says it was not found, rather than only that it is uncertain', () => {
    const rows = toExtractedFieldRows(base({ fields: [field('importer_eori', null, 0.96)] }))
    expect(rows[0].flagReason).toContain('value_not_found')
  })

  it('leaves a field that does have a value alone', () => {
    const rows = toExtractedFieldRows(base({ fields: [field('importer_eori', 'GB123', 0.96)] }))
    expect(rows[0].confidenceScore).toBe(0.96)
    expect(rows[0].flagReason ?? '').not.toContain('value_not_found')
  })
})

describe('a document flag that names a field', () => {
  it('attaches to that field, not to every field', () => {
    // The real document put repair_failed:invoice_date on all six rows. A
    // reviewer scanning six identical flags learns nothing from any of them.
    const rows = toExtractedFieldRows(
      base({
        fields: [field('invoice_date', null, 0.9), field('importer_eori', 'GB1', 0.9)],
        flags: ['repair_failed:invoice_date'],
      }),
    )
    const eori = rows.find(r => r.fieldName === 'importer_eori')!
    expect(eori.flagReason ?? '').not.toContain('repair_failed')
  })

  it('still reaches the field it names', () => {
    const rows = toExtractedFieldRows(
      base({ fields: [field('invoice_date', null, 0.9)], flags: ['repair_failed:invoice_date'] }),
    )
    expect(rows.find(r => r.fieldName === 'invoice_date')!.flagReason).toContain('repair_failed')
  })

  it('creates a row for a named field that produced nothing at all', () => {
    // Otherwise the one signal that the field was sought and not found is
    // dropped, and the field simply does not appear.
    const rows = toExtractedFieldRows(base({ flags: ['repair_failed:invoice_date'] }))
    const row = rows.find(r => r.fieldName === 'invoice_date')
    expect(row).toBeDefined()
    expect(row!.rawValue).toBeNull()
    expect(row!.confidenceScore).toBe(0)
  })

  it('keeps a genuinely document-wide flag on every field', () => {
    // source_truncated is about the document, so it belongs on everything
    // confirmed from it.
    const rows = toExtractedFieldRows(
      base({
        fields: [field('a', '1', 0.9), field('b', '2', 0.9)],
        flags: ['source_truncated:page cap'],
      }),
    )
    expect(rows.every(r => (r.flagReason ?? '').includes('source_truncated'))).toBe(true)
  })
})

describe('CN code length', () => {
  const withCode = (code: string) =>
    toExtractedFieldRows(
      base({
        lines: [{ line_index: 0, cn_code: code, net_mass_kg: 172, flags: [] }],
      } as unknown as Partial<CbamExtractionResult>),
    ).find(r => r.fieldName === 'lines[0].cn_code')!

  it('accepts a full 8-digit code', () => {
    expect(withCode('72071111').flagReason ?? '').not.toContain('cn_code_not_8_digit')
  })

  it('rejects the 7-digit code the real document produced', () => {
    // 0004417 came off a live customs declaration and nothing objected, because
    // the existing rule looks for a field called commodity_code and Nucleos
    // emits lines[0].cn_code.
    expect(withCode('0004417').flagReason).toContain('cn_code_not_8_digit')
  })

  it('rejects a 6-digit code, which is the HS heading rather than a CN code', () => {
    expect(withCode('720711').flagReason).toContain('cn_code_not_8_digit')
  })

  it('ignores separators when counting digits', () => {
    expect(withCode('7207 11 11').flagReason ?? '').not.toContain('cn_code_not_8_digit')
  })

  it('flags a code that is not digits at all', () => {
    expect(withCode('n/a').flagReason).toContain('cn_code_not_8_digit')
  })
})
