import { mapCdsDeclarations, mapSapMaterialDocs, mapNetSuiteItemReceipts } from '../mappers'

// Gap 9 — pure mapping from provider payloads to Arbor integration records.
describe('mapCdsDeclarations', () => {
  it('maps HMRC CDS declarations to LOGISTICS weight records', () => {
    const out = mapCdsDeclarations({
      declarations: [
        { movementReferenceNumber: 'MRN1', declaredWeight: 12000, weightUnit: 'kg', declarationDate: '2026-02-01' },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ domain: 'LOGISTICS', fieldName: 'declared_weight', value: 12000, unit: 'kg', sourceRef: 'MRN1' })
    expect(out[0].periodStart instanceof Date).toBe(true)
  })

  it('skips declarations missing weight or reference', () => {
    const out = mapCdsDeclarations({
      declarations: [
        { movementReferenceNumber: '', declaredWeight: 1, weightUnit: 'kg', declarationDate: '2026-02-01' },
        { movementReferenceNumber: 'MRN2', declaredWeight: null as unknown as number, weightUnit: 'kg', declarationDate: '2026-02-01' },
      ],
    })
    expect(out).toHaveLength(0)
  })
})

describe('mapSapMaterialDocs', () => {
  it('maps SAP material documents to MATERIALS quantity records', () => {
    const out = mapSapMaterialDocs({
      d: { results: [{ MaterialDocument: 'MD1', QuantityInEntryUnit: '500', EntryUnit: 'KG', PostingDate: '2026-03-10' }] },
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ domain: 'MATERIALS', fieldName: 'quantity', value: 500, unit: 'KG', sourceRef: 'MD1' })
  })
})

describe('mapNetSuiteItemReceipts', () => {
  it('maps NetSuite item receipts to MATERIALS quantity records', () => {
    const out = mapNetSuiteItemReceipts({
      items: [{ id: 'IR1', quantity: 42, unit: 'units', tranDate: '2026-04-05' }],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ domain: 'MATERIALS', fieldName: 'quantity', value: 42, unit: 'units', sourceRef: 'IR1' })
  })

  it('ignores rows with non-positive quantity', () => {
    const out = mapNetSuiteItemReceipts({ items: [{ id: 'IR2', quantity: 0, unit: 'units', tranDate: '2026-04-05' }] })
    expect(out).toHaveLength(0)
  })
})
