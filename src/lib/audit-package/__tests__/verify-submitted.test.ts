import { verifySubmittedPackage } from '../verify-submitted'
import { generateAuditPackage } from '../generator'

process.env.AUDIT_CHAIN_SECRET ??= 'test-secret'

function buildPackage() {
  return generateAuditPackage({
    entityId: 'entity-1',
    entityName: 'Sheffield Steel Ltd',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-03-31T00:00:00Z'),
    generatedAt: new Date('2026-04-02T09:00:00Z'),
    dataRecords: [
      {
        id: 'rec-1',
        entityId: 'entity-1',
        domain: 'ENERGY',
        fieldName: 'total_consumption_kwh',
        value: 1_000_000,
        unit: 'MJ',
        trustTier: 'A',
        confidenceScore: 0.97,
        sourceText: 'Total consumption 277,778 kWh',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-03-31T00:00:00Z'),
        extractionMethod: 'DOCUMENT_AI',
        documentId: 'doc-1',
        auditHash: 'a'.repeat(64),
      },
    ],
    sourceDocuments: [
      {
        id: 'doc-1',
        documentType: 'ELECTRICITY_BILL',
        fileName: 'q1-electricity.pdf',
        submittedAt: new Date('2026-04-01T12:00:00Z'),
        trustTier: 'A',
      },
    ],
    crossValidationResults: [],
    verification: null,
  })
}

/** Round-trip through JSON, as an auditor holding the file would have it. */
function asSubmitted(pkg: ReturnType<typeof buildPackage>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(pkg))
}

describe('verifySubmittedPackage', () => {
  it('confirms an untouched package: its contents recompute to the hash it carries', () => {
    const result = verifySubmittedPackage(asSubmitted(buildPackage()))
    expect(result).toMatchObject({ ok: true, contentsMatchHash: true, entityId: 'entity-1' })
  })

  // The defect this exists to close: the old endpoint checked only that the hash
  // existed in the database, so an edited package carrying the original hash
  // verified clean.
  it('rejects a package whose figures were edited but whose hash was kept', () => {
    const tampered = asSubmitted(buildPackage())
    const records = tampered.dataRecords as Array<Record<string, unknown>>
    records[0].value = 1
    const result = verifySubmittedPackage(tampered)
    expect(result).toMatchObject({ ok: true, contentsMatchHash: false })
  })

  it('rejects a package whose trust tier was upgraded in place', () => {
    const tampered = asSubmitted(buildPackage())
    const records = tampered.dataRecords as Array<Record<string, unknown>>
    records[0].trustTier = 'A'
    records[0].confidenceScore = 1
    expect(verifySubmittedPackage(tampered)).toMatchObject({ contentsMatchHash: false })
  })

  it('rejects a package with a record removed', () => {
    const tampered = asSubmitted(buildPackage())
    tampered.dataRecords = []
    expect(verifySubmittedPackage(tampered)).toMatchObject({ contentsMatchHash: false })
  })

  it('rejects a package re-labelled with another entity name', () => {
    const tampered = asSubmitted(buildPackage())
    tampered.entityName = 'Someone Else Ltd'
    expect(verifySubmittedPackage(tampered)).toMatchObject({ contentsMatchHash: false })
  })

  it('is unaffected by key order, since the hash sorts keys', () => {
    const pkg = asSubmitted(buildPackage())
    const reordered = Object.fromEntries(Object.entries(pkg).reverse())
    expect(verifySubmittedPackage(reordered)).toMatchObject({ contentsMatchHash: true })
  })

  it('reports malformed input rather than guessing', () => {
    expect(verifySubmittedPackage({ nope: true })).toEqual({ ok: false, reason: 'malformed' })
    expect(verifySubmittedPackage(null)).toEqual({ ok: false, reason: 'malformed' })
  })
})
