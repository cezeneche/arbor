// Layer 3 — what a stored record set can honestly be said to be missing.
//
// The old answer was nonsense. Completeness was scored against the union of the
// compulsory fields of EVERY document type in a domain, so one freight invoice
// was marked as missing the bill-of-lading and customs-declaration fields, and
// one electricity bill was marked as missing the REGO certificate fields. It
// also counted fields that can never be records: only numeric fields become
// DataRecords, so account_holder_name and site_address were permanently
// "missing" by construction. That is how a company with two clean documents was
// told it had 110 missing compulsory fields at 4% complete.
//
// Compulsory-ness belongs to a document type (admissibility spec), and is judged
// at ingest. All this can honestly report afterwards is: of the fields that both
// belong to a submitted document type AND can be stored as records, which are
// absent.

import {
  getCompulsoryStorableFieldsByDocumentType,
  expectedFieldsFor,
} from '../compulsory-fields'

describe('getCompulsoryStorableFieldsByDocumentType', () => {
  const byType = getCompulsoryStorableFieldsByDocumentType()

  it('keeps the compulsory numeric field of an electricity bill', () => {
    expect(byType.ELECTRICITY_BILL).toContain('total_consumption_kwh')
  })

  it('drops compulsory text fields, which can never be stored as records', () => {
    // These are real compulsory fields, collected and checked at ingest — but a
    // DataRecord holds a number, so their absence here is not a data gap.
    expect(byType.ELECTRICITY_BILL).not.toContain('account_holder_name')
    expect(byType.ELECTRICITY_BILL).not.toContain('site_address')
    expect(byType.ELECTRICITY_BILL).not.toContain('supplier_name')
  })

  it('keeps each document type separate', () => {
    // A freight invoice is not missing bill-of-lading fields.
    expect(byType.FREIGHT_INVOICE ?? []).not.toContain('gross_weight')
    expect(byType.BILL_OF_LADING ?? []).toContain('gross_weight')
  })

  it('never lists a field twice', () => {
    for (const fields of Object.values(byType)) {
      expect(new Set(fields).size).toBe(fields.length)
    }
  })
})

describe('expectedFieldsFor', () => {
  const byType = {
    ELECTRICITY_BILL: ['total_consumption_kwh'],
    FREIGHT_INVOICE: ['shipment_weight'],
    BILL_OF_LADING: ['gross_weight'],
  }

  it('expects only what the submitted document types actually require', () => {
    expect(expectedFieldsFor(['FREIGHT_INVOICE'], byType)).toEqual(['shipment_weight'])
  })

  it('unions across several submitted types', () => {
    expect(expectedFieldsFor(['FREIGHT_INVOICE', 'BILL_OF_LADING'], byType).sort())
      .toEqual(['gross_weight', 'shipment_weight'])
  })

  it('expects nothing from a document type that was never submitted', () => {
    expect(expectedFieldsFor(['FREIGHT_INVOICE'], byType)).not.toContain('gross_weight')
  })

  it('expects nothing at all when no document backs the records', () => {
    // Manual entry has no document type, so there is no admissibility spec to
    // hold it to. Inventing one would mark every hand-entered figure incomplete.
    expect(expectedFieldsFor([], byType)).toEqual([])
    expect(expectedFieldsFor([null], byType)).toEqual([])
  })

  it('ignores a document type with no admissibility spec', () => {
    expect(expectedFieldsFor(['OTHER'], byType)).toEqual([])
  })

  it('does not repeat a field two document types share', () => {
    const shared = { A_TYPE: ['quantity'], B_TYPE: ['quantity'] }
    expect(expectedFieldsFor(['A_TYPE', 'B_TYPE'], shared)).toEqual(['quantity'])
  })
})
