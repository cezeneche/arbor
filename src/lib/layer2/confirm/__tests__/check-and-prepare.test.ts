import { confirmFieldErrors, confirmedValuesOf, missingDocumentDateError } from '../check'
import { duplicateCandidates, isPositionalField, prepareFields } from '../prepare'
import type { ConfirmRequest } from '../request'

// The pure parts of a confirmation, now that they live outside the route.

const JAN = { periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-31T23:59:59.999Z' }
const field = (fieldName: string, confirmedValue = '1', extra = {}) => ({
  fieldName,
  confirmedValue,
  domain: 'ENERGY' as const,
  ...JAN,
  ...extra,
})

describe('confirmFieldErrors', () => {
  it('accepts a field the document type has', () => {
    expect(
      confirmFieldErrors('ELECTRICITY_BILL', false, [
        field('total_consumption_kwh', '1200', { confirmedUnit: 'kWh' }),
      ]),
    ).toEqual([])
  })

  it('names a field the document type does not have', () => {
    const errors = confirmFieldErrors('ELECTRICITY_BILL', false, [field('shoe_size')])
    expect(errors.map(e => e.fieldName)).toEqual(['shoe_size'])
  })

  it('checks a CBAM document against the CBAM vocabulary, not the fixed list', () => {
    expect(
      confirmFieldErrors('CUSTOMS_DECLARATION', true, [
        field('lines[0].net_mass_kg', '24500', { confirmedUnit: 'kg' }),
      ]),
    ).toEqual([])
    expect(
      confirmFieldErrors('CUSTOMS_DECLARATION', true, [field('lines[0].shoe_size')]).map(e => e.problem),
    ).toContain('unknown_field')
  })
})

describe('confirmedValuesOf', () => {
  it('joins identifiers and measurements, measurements winning', () => {
    const request: ConfirmRequest = {
      fields: [field('total_consumption_kwh', '1200')],
      context: [
        { fieldName: 'account_holder_name', confirmedValue: 'Acme' },
        { fieldName: 'total_consumption_kwh', confirmedValue: '999' },
      ],
    }
    expect([...confirmedValuesOf(request)]).toEqual([
      ['account_holder_name', 'Acme'],
      ['total_consumption_kwh', '1200'],
    ])
  })
})

describe('missingDocumentDateError', () => {
  it('asks a CBAM document for its import date', () => {
    expect(missingDocumentDateError('CUSTOMS_DECLARATION', true, new Map())?.problem).toBe(
      'missing_document_date',
    )
    expect(
      missingDocumentDateError('CUSTOMS_DECLARATION', true, new Map([['import_date', '2026-01-15']])),
    ).toBeNull()
  })

  it('asks nothing of other documents', () => {
    expect(missingDocumentDateError('ELECTRICITY_BILL', false, new Map())).toBeNull()
  })
})

describe('prepareFields', () => {
  it('reads the number, its periods, and converts units the converter knows', () => {
    const [p] = prepareFields([field('total_consumption_kwh', '1,200', { confirmedUnit: 'kwh' })])
    expect(p).toMatchObject({
      rawNum: 1200,
      siValue: 4320,
      siUnit: 'mj',
      periodStart: new Date(JAN.periodStart),
    })
  })

  it('passes other spellings through for the record writer to canonicalise', () => {
    const [p] = prepareFields([field('total_consumption_kwh', '1200', { confirmedUnit: 'kWh' })])
    expect(p).toMatchObject({ rawNum: 1200, siValue: 1200, siUnit: 'kWh' })
  })
})

describe('positional goods-line fields', () => {
  it('are positional only on a CBAM document', () => {
    expect(isPositionalField(true, 'lines[0].net_mass_kg')).toBe(true)
    expect(isPositionalField(false, 'lines[0].net_mass_kg')).toBe(false)
    expect(isPositionalField(true, 'import_date')).toBe(false)
  })

  it('are never duplicate candidates', () => {
    const prepared = prepareFields([field('lines[0].net_mass_kg'), field('total_consumption_kwh')])
    expect(duplicateCandidates(prepared, true).map(c => c.fieldName)).toEqual(['total_consumption_kwh'])
  })
})
