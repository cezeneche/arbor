import { missingCaseIdentifiers, amendCaseIdentifiers } from '../case-identifiers'

// A confirmed CBAM document whose case could not be opened for want of an
// identifier used to be retried with the same stored input until the sweep gave
// up, while the confirm route refused to let anyone add the missing value. The
// handoff now waits for the identifier, and these decide what may be asked for
// and what may be written.

const confirmed = (over: Record<string, string> = {}) =>
  new Map(
    Object.entries({
      importer_name: 'Midlands Steel Ltd',
      origin_country: 'IN',
      'lines[0].cn_code': '72081000',
      'lines[0].net_mass_kg': '24000',
      ...over,
    }),
  )

describe('missingCaseIdentifiers', () => {
  it('asks for the importer EORI when none was confirmed', () => {
    expect(missingCaseIdentifiers(confirmed())).toEqual([
      { fieldName: 'importer_eori', label: 'Importer EORI' },
    ])
  })

  it('asks for the code of a goods line that has a weight but no code', () => {
    const m = confirmed({ importer_eori: 'GB123456789000', 'lines[1].net_mass_kg': '5000' })
    expect(missingCaseIdentifiers(m)).toEqual([
      { fieldName: 'lines[1].cn_code', label: 'Commodity code for goods line 2' },
    ])
  })

  // A weight is a certified record. Supplying one here would put a figure on
  // the return that was never confirmed against the document.
  it('never asks for a weight', () => {
    const m = confirmed({ importer_eori: 'GB123456789000', 'lines[1].cn_code': '76011000' })
    expect(missingCaseIdentifiers(m)).toEqual([])
  })
})

describe('amendCaseIdentifiers', () => {
  it('adds a missing EORI, normalised', () => {
    const r = amendCaseIdentifiers(confirmed(), [
      { fieldName: 'importer_eori', value: ' gb 1234 5678 9000 ' },
    ])
    expect(r.errors).toEqual([])
    expect(r.confirmed!.get('importer_eori')).toBe('GB123456789000')
  })

  it('adds a missing CN code, normalised to eight digits', () => {
    const m = confirmed({ importer_eori: 'GB123456789000', 'lines[1].net_mass_kg': '5000' })
    const r = amendCaseIdentifiers(m, [{ fieldName: 'lines[1].cn_code', value: '7601 10.00' }])
    expect(r.errors).toEqual([])
    expect(r.confirmed!.get('lines[1].cn_code')).toBe('76011000')
  })

  it('refuses an EORI that is not one', () => {
    const r = amendCaseIdentifiers(confirmed(), [{ fieldName: 'importer_eori', value: '123' }])
    expect(r.confirmed).toBeNull()
    expect(r.errors[0]).toMatchObject({ fieldName: 'importer_eori' })
  })

  it('refuses a six-digit heading', () => {
    const m = confirmed({ importer_eori: 'GB123456789000', 'lines[1].net_mass_kg': '5000' })
    const r = amendCaseIdentifiers(m, [{ fieldName: 'lines[1].cn_code', value: '760110' }])
    expect(r.confirmed).toBeNull()
  })

  // The reviewer confirmed these against the document. A later form cannot
  // overwrite them.
  it('refuses to replace a value that was already confirmed', () => {
    const r = amendCaseIdentifiers(confirmed({ importer_eori: 'GB123456789000' }), [
      { fieldName: 'importer_eori', value: 'GB999999999999' },
    ])
    expect(r.confirmed).toBeNull()
    expect(r.errors[0].message).toMatch(/already/i)
  })

  it('refuses anything that is not a missing identifier', () => {
    const r = amendCaseIdentifiers(confirmed(), [{ fieldName: 'lines[0].net_mass_kg', value: '1' }])
    expect(r.confirmed).toBeNull()
  })

  it('refuses an empty amendment', () => {
    expect(amendCaseIdentifiers(confirmed(), []).confirmed).toBeNull()
  })
})
