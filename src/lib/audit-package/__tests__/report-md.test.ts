// The human-readable half of the audit package.
//
// The JSON is what a verifier's tooling checks — Merkle proofs, integrity hash,
// per-record provenance. It is not what a person reads first. PRD §12.4 wants a
// package that can be "handed directly to an accredited third-party verifier
// without further manual preparation", and a raw JSON blob fails that test for
// the human who opens it before forwarding.
//
// This renders the same package as structured Markdown. It states figures that
// are already in the package and never computes a new one — Layer 3 formats and
// translates, nothing more.

import { renderAuditReportMarkdown } from '../report-md'
import type { AuditPackage } from '../generator'

const pkg: AuditPackage = {
  entityId: 'ent-1',
  entityName: 'Acme Steel',
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-03-31T23:59:59.999Z'),
  generatedAt: new Date('2026-08-06T10:30:00.000Z'),
  summary: {
    totalRecords: 3,
    tierACount: 2,
    tierBCount: 1,
    tierCCount: 0,
    sourceDocumentCount: 2,
    crossValidationPassCount: 1,
    crossValidationFailCount: 0,
  },
  dataRecords: [
    {
      id: 'rec-1',
      entityId: 'ent-1',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      value: 480000,
      unit: 'mj',
      trustTier: 'A',
      confidenceScore: 0.97,
      sourceText: 'Total consumption 133,333 kWh',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T23:59:59.999Z'),
      extractionMethod: 'DOCUMENT_AI',
      documentId: 'doc-1',
      auditHash: 'aaaa1111',
    },
    {
      id: 'rec-2',
      entityId: 'ent-1',
      domain: 'LOGISTICS',
      fieldName: 'declared_weight',
      value: 24500,
      unit: 'kg',
      trustTier: 'B',
      confidenceScore: 0.62,
      sourceText: null,
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T23:59:59.999Z'),
      extractionMethod: 'MANUAL_ENTRY',
      documentId: null,
      auditHash: 'bbbb2222',
    },
  ],
  sourceDocuments: [
    {
      id: 'doc-1',
      documentType: 'ELECTRICITY_BILL',
      fileName: 'q1-electricity.pdf',
      submittedAt: new Date('2026-04-02T09:00:00.000Z'),
      trustTier: 'A',
    },
  ],
  crossValidationResults: [
    {
      id: 'cv-1',
      documentAId: 'doc-1',
      documentBId: 'doc-2',
      fieldName: 'total_consumption_kwh',
      valueA: 480000,
      valueB: 479500,
      discrepancyPercent: 0.1,
      passed: true,
    },
  ],
  verification: null,
  packageIntegrityHash: 'deadbeefcafe',
  merkle: {
    algorithm: 'RFC6962-SHA256',
    root: 'rootbeef',
    leafCount: 2,
    inclusionProofs: [],
    consistent: true,
  },
  verificationInstructions: {
    description: 'To independently verify this package, send a GET request…',
    endpoint: '/api/audit/verify-public',
    params: { packageHash: 'deadbeefcafe', entityId: 'ent-1' },
    expectedResponse: { verified: true },
  },
}

describe('renderAuditReportMarkdown', () => {
  const md = renderAuditReportMarkdown(pkg)

  it('opens with a heading naming the entity and the period', () => {
    expect(md.startsWith('# ')).toBe(true)
    expect(md).toContain('Acme Steel')
    expect(md).toContain('1 January 2026')
    expect(md).toContain('31 March 2026')
  })

  it('states the integrity hash and how to check it independently', () => {
    expect(md).toContain('deadbeefcafe')
    expect(md).toContain('/api/audit/verify-public')
  })

  it('reports the Merkle root and that every proof recomputed to it', () => {
    expect(md).toContain('rootbeef')
    expect(md).toContain('RFC6962-SHA256')
  })

  it('gives the tier breakdown using the plain English labels', () => {
    // Tier codes alone are meaningless to a verifier reading this cold.
    expect(md).toContain('Verified')
    expect(md).toContain('Declared')
  })

  it('renders the records as a table including tier and source document', () => {
    expect(md).toContain('| Domain | Field | Value | Unit | Tier |')
    expect(md).toContain('total_consumption_kwh')
    expect(md).toContain('480000')
    expect(md).toContain('q1-electricity.pdf')
  })

  it('says explicitly when a record has no source document rather than leaving a blank', () => {
    // Same table row, so no dotAll needed.
    expect(md).toMatch(/declared_weight.*No document/)
  })

  it('lists the cross-validation results with their outcome', () => {
    expect(md).toContain('Cross-validation')
    expect(md).toContain('0.1%')
  })

  it('states that no independent verification has been recorded when there is none', () => {
    expect(md).toContain('No independent verification')
  })

  it('names the verifier when the package has been signed off', () => {
    const verified = renderAuditReportMarkdown({
      ...pkg,
      verification: {
        status: 'INDEPENDENTLY_VERIFIED',
        verifierName: 'Bureau Veritas',
        verifiedAt: '2026-08-01T00:00:00.000Z',
        signatureHash: 'sig123',
      },
    })
    expect(verified).toContain('Bureau Veritas')
    expect(verified).toContain('sig123')
  })

  it('states what Arbor does and does not certify', () => {
    // PRD §23: provenance certification, not truth certification. A verifier
    // must not infer more from this document than it actually claims.
    expect(md).toContain('provenance')
    expect(md).not.toMatch(/guarantees the figures are correct/i)
  })

  it('escapes a pipe in text so it cannot break the table', () => {
    const risky = renderAuditReportMarkdown({
      ...pkg,
      dataRecords: [{ ...pkg.dataRecords[0], fieldName: 'weird|field' }],
    })
    expect(risky).toContain('weird\\|field')
  })

  it('handles an empty package without producing a broken document', () => {
    const empty = renderAuditReportMarkdown({
      ...pkg,
      dataRecords: [],
      sourceDocuments: [],
      crossValidationResults: [],
      summary: { ...pkg.summary, totalRecords: 0, tierACount: 0, tierBCount: 0, sourceDocumentCount: 0, crossValidationPassCount: 0 },
    })
    expect(empty).toContain('No records')
    expect(empty).not.toContain('undefined')
  })

  it('never contains undefined or NaN', () => {
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('NaN')
  })
})
