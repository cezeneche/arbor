import { generateAuditPackage, type AuditPackageInput } from '../generator'

function makeRecord(
  id: string,
  trustTier: 'A' | 'B' | 'C' = 'A',
  fieldName = 'total_consumption_kwh',
): AuditPackageInput['dataRecords'][0] {
  return {
    id,
    entityId: 'entity-1',
    domain: 'ENERGY',
    fieldName,
    value: 1000,
    unit: 'kWh',
    trustTier,
    confidenceScore: 0.95,
    sourceText: 'Source text from document',
    periodStart: new Date('2024-01-01'),
    periodEnd: new Date('2024-03-31'),
    extractionMethod: 'AI_EXTRACTED',
    documentId: 'doc-1',
  }
}

function makeDocument(
  id: string,
  documentType = 'ELECTRICITY_BILL',
): AuditPackageInput['sourceDocuments'][0] {
  return {
    id,
    documentType,
    fileName: `${id}.pdf`,
    submittedAt: new Date('2024-04-01'),
    trustTier: 'A',
  }
}

const BASE_INPUT: AuditPackageInput = {
  entityId: 'entity-1',
  entityName: 'Acme Ltd',
  periodStart: new Date('2024-01-01'),
  periodEnd: new Date('2024-12-31'),
  dataRecords: [makeRecord('r1'), makeRecord('r2', 'B')],
  sourceDocuments: [makeDocument('doc-1')],
  crossValidationResults: [],
  generatedAt: new Date('2025-01-15'),
}

describe('generateAuditPackage', () => {
  it('returns a package with entityId and entityName', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.entityId).toBe('entity-1')
    expect(pkg.entityName).toBe('Acme Ltd')
  })

  it('includes all data records in the package', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.dataRecords).toHaveLength(2)
  })

  it('includes source document index', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.sourceDocuments).toHaveLength(1)
    expect(pkg.sourceDocuments[0].id).toBe('doc-1')
  })

  it('summary counts Tier A and Tier B separately', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.summary.tierACount).toBe(1)
    expect(pkg.summary.tierBCount).toBe(1)
    expect(pkg.summary.tierCCount).toBe(0)
  })

  it('summary totalRecords equals dataRecords length', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.summary.totalRecords).toBe(2)
  })

  it('generatedAt is preserved in the package', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.generatedAt).toEqual(new Date('2025-01-15'))
  })

  it('period start and end are preserved', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    expect(pkg.periodStart).toEqual(new Date('2024-01-01'))
    expect(pkg.periodEnd).toEqual(new Date('2024-12-31'))
  })

  it('cross validation results are included', () => {
    const inputWithXV: AuditPackageInput = {
      ...BASE_INPUT,
      crossValidationResults: [
        {
          id: 'cv-1',
          documentAId: 'doc-1',
          documentBId: 'doc-2',
          fieldName: 'total_quantity',
          valueA: 100,
          valueB: 101,
          discrepancyPercent: 1,
          passed: true,
        },
      ],
    }
    const pkg = generateAuditPackage(inputWithXV)
    expect(pkg.crossValidationResults).toHaveLength(1)
    expect(pkg.crossValidationResults[0].passed).toBe(true)
  })

  it('trust tier travels with each data record', () => {
    const pkg = generateAuditPackage(BASE_INPUT)
    const tierBRecord = pkg.dataRecords.find((r) => r.id === 'r2')
    expect(tierBRecord?.trustTier).toBe('B')
  })

  it('is a pure function  -  same inputs always return same outputs', () => {
    const a = generateAuditPackage(BASE_INPUT)
    const b = generateAuditPackage(BASE_INPUT)
    expect(a.summary.totalRecords).toBe(b.summary.totalRecords)
    expect(a.entityId).toBe(b.entityId)
  })

  it('empty records → summary counts are all 0', () => {
    const input: AuditPackageInput = { ...BASE_INPUT, dataRecords: [] }
    const pkg = generateAuditPackage(input)
    expect(pkg.summary.totalRecords).toBe(0)
    expect(pkg.summary.tierACount).toBe(0)
  })
})
