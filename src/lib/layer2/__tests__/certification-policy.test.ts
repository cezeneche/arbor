import { certifyTier } from '../certification-policy'

// One policy decides the trust tier of a confirmed document: the admissibility
// spec, applied to the effective document — what the extraction found, with the
// reviewer's corrections on top. Extraction applies the same rules, so a
// document cannot come out of review better evidenced than it went in, except by
// the reviewer actually supplying what was missing.
//
// Human confirmation of a number is not evidence about how it was measured. An
// estimated meter read confirmed by a person is still an estimate.

const BILL: Record<string, string> = {
  account_holder_name: 'Acme Ltd',
  site_address: '1 Industrial Way',
  meter_reference: 'S1234567890',
  period_start: '2024-01-01',
  period_end: '2024-03-31',
  total_consumption_kwh: '150000',
  read_type: 'ACTUAL',
  supplier_name: 'British Gas',
  invoice_number: 'INV-001',
  invoice_date: '2024-04-01',
}

const base = {
  documentType: 'ELECTRICITY_BILL',
  entityName: 'Acme Ltd',
  hasExtraction: true,
}

const extracted = (over: Record<string, string | null> = {}) =>
  new Map<string, string | null>(Object.entries({ ...BILL, ...over }))

describe('certifyTier', () => {
  it('is Verified for a complete, actual-read bill', () => {
    const result = certifyTier({
      ...base,
      extracted: extracted(),
      confirmed: new Map([['total_consumption_kwh', '150000']]),
    })
    expect(result.tier).toBe('A')
    expect(result.reasons).toEqual([])
  })

  // Audit P0 #2: extraction said Declared, confirmation said Verified.
  it('keeps an estimated meter read Declared after a person confirms the figure', () => {
    const result = certifyTier({
      ...base,
      extracted: extracted({ read_type: 'ESTIMATED' }),
      confirmed: new Map([['total_consumption_kwh', '150000']]),
    })
    expect(result.tier).toBe('B')
    expect(result.reasons.join(' ')).toMatch(/ESTIMATED/)
  })

  it('is Declared when the reviewer changes an actual read to an estimated one', () => {
    const result = certifyTier({
      ...base,
      extracted: extracted(),
      confirmed: new Map([['read_type', 'ESTIMATED']]),
    })
    expect(result.tier).toBe('B')
  })

  // Audit P0 #2: an OTHER document has no spec, so nothing about it can be verified.
  it('keeps a document type with no admissibility spec Declared', () => {
    const result = certifyTier({
      documentType: 'OTHER',
      entityName: 'Acme Ltd',
      hasExtraction: true,
      extracted: new Map([['rent', '100']]),
      confirmed: new Map([['rent', '100']]),
    })
    expect(result.tier).toBe('B')
  })

  it('keeps a supplier questionnaire Declared, as extraction does', () => {
    const result = certifyTier({
      documentType: 'SUPPLIER_QUESTIONNAIRE',
      entityName: 'Acme Ltd',
      hasExtraction: true,
      extracted: new Map(),
      confirmed: new Map([['total_consumption_kwh', '1']]),
    })
    expect(result.tier).toBe('B')
  })

  it('is Declared when the extraction missed a compulsory field and nobody supplied it', () => {
    const result = certifyTier({
      ...base,
      extracted: extracted({ meter_reference: null }),
      confirmed: new Map(),
    })
    expect(result.tier).toBe('B')
  })

  it('is Declared when the reviewer cleared a compulsory field the extraction had found', () => {
    const result = certifyTier({
      ...base,
      extracted: extracted(),
      confirmed: new Map([['meter_reference', '   ']]),
    })
    expect(result.tier).toBe('B')
  })

  it('is Verified when the reviewer supplied a compulsory field the extraction missed', () => {
    const result = certifyTier({
      ...base,
      extracted: extracted({ meter_reference: null }),
      confirmed: new Map([['meter_reference', 'S1234567890']]),
    })
    expect(result.tier).toBe('A')
  })

  it('is Declared when nothing was read from a document at all', () => {
    const result = certifyTier({
      ...base,
      hasExtraction: false,
      extracted: new Map(),
      confirmed: new Map(Object.entries(BILL)),
    })
    expect(result.tier).toBe('B')
  })

  it('is Declared for a certificate that expired before the period its records cover', () => {
    const result = certifyTier({
      documentType: 'RENEWABLE_CERTIFICATE',
      entityName: 'Acme Ltd',
      hasExtraction: true,
      extracted: new Map([['expiry_date', '2024-01-31']]),
      confirmed: new Map(),
      reportingPeriodEnd: new Date('2024-03-31T00:00:00Z'),
    })
    expect(result.tier).toBe('B')
    expect(result.reasons.join(' ')).toMatch(/expired/i)
  })

  it('is Declared for a 6-digit commodity code on a customs declaration', () => {
    const result = certifyTier({
      documentType: 'CUSTOMS_DECLARATION',
      entityName: 'Acme Ltd',
      hasExtraction: true,
      extracted: new Map([['commodity_code', '720851']]),
      confirmed: new Map(),
    })
    expect(result.tier).toBe('B')
  })
})

// Verified is a claim that a record can be confirmed against the document it
// came from. The policy built its fields with an empty sourceText and asked the
// admissibility spec, which does not look at source text at all — so a document
// whose values arrived with nothing to confirm them against was certified
// Verified, which is the one thing this tier must never mean.
describe('what each value can be confirmed against', () => {
  const sourceText = (over: Record<string, string> = {}) =>
    new Map<string, string | null>([
      ...Object.keys(BILL).map(k => [k, `…${BILL[k]}…`] as [string, string | null]),
      ...Object.entries(over),
    ])

  it('is Verified when every compulsory value carries the text it was read from', () => {
    const result = certifyTier({
      ...base,
      extracted: new Map(Object.entries(BILL)),
      confirmed: new Map(),
      sourceText: sourceText(),
    })
    expect(result.tier).toBe('A')
  })

  it('is Declared when a compulsory value has no source text', () => {
    const result = certifyTier({
      ...base,
      extracted: new Map(Object.entries(BILL)),
      confirmed: new Map(),
      sourceText: sourceText({ total_consumption_kwh: '' }),
    })
    expect(result.tier).toBe('B')
    expect(result.reasons.join(' ')).toMatch(/confirm/i)
  })

  it('says which value could not be confirmed, in plain English', () => {
    const result = certifyTier({
      ...base,
      extracted: new Map(Object.entries(BILL)),
      confirmed: new Map(),
      sourceText: sourceText({ meter_reference: '' }),
    })
    expect(result.reasons.join(' ')).toContain('meter reference')
  })

  it('is unchanged when the caller supplies no source text at all', () => {
    const result = certifyTier({
      ...base,
      extracted: new Map(Object.entries(BILL)),
      confirmed: new Map(),
    })
    expect(result.tier).toBe('A')
  })
})
