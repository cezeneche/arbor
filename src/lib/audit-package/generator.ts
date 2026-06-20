// Layer 3  -  packaging only. No calculation logic. No DB reads. No API calls.
// Assembles DataRecords, source documents, audit chain, and cross-validation results
// into a structured JSON package for third-party verification (Bureau Veritas, SGS, EY, etc.)
import { computePackageHash } from '@/lib/layer2/verification-signature'

export interface AuditDataRecord {
  id: string
  entityId: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
  confidenceScore: number
  sourceText: string | null
  periodStart: Date
  periodEnd: Date
  extractionMethod: string
  documentId: string | null
}

export interface AuditSourceDocument {
  id: string
  documentType: string
  fileName: string
  submittedAt: Date
  trustTier: 'A' | 'B' | 'C'
}

export interface AuditCrossValidationResult {
  id: string
  documentAId: string
  documentBId: string
  fieldName: string
  valueA: number
  valueB: number
  discrepancyPercent: number
  passed: boolean
}

// Gap 3 — third-party verification status carried in the package.
export interface AuditVerification {
  status: 'INDEPENDENTLY_VERIFIED' | 'REJECTED'
  verifierName: string
  verifiedAt: string
  signatureHash: string
}

export interface AuditPackageInput {
  entityId: string
  entityName: string
  periodStart: Date
  periodEnd: Date
  dataRecords: AuditDataRecord[]
  sourceDocuments: AuditSourceDocument[]
  crossValidationResults: AuditCrossValidationResult[]
  generatedAt: Date
  /** Gap 3 — present when an assigned verifier has signed off this entity+period. */
  verification?: AuditVerification | null
  /** Gap 4 — public verify endpoint embedded in the package's instructions. */
  publicVerifyEndpoint?: string
}

// Gap 4 — instructions an external auditor can follow to verify the package
// without an Arbor account.
export interface VerificationInstructions {
  description: string
  endpoint: string
  params: { packageHash: string; entityId: string }
  expectedResponse: { verified: true }
}

export interface AuditPackageSummary {
  totalRecords: number
  tierACount: number
  tierBCount: number
  tierCCount: number
  sourceDocumentCount: number
  crossValidationPassCount: number
  crossValidationFailCount: number
}

export interface AuditPackage {
  entityId: string
  entityName: string
  periodStart: Date
  periodEnd: Date
  generatedAt: Date
  summary: AuditPackageSummary
  dataRecords: AuditDataRecord[]
  sourceDocuments: AuditSourceDocument[]
  crossValidationResults: AuditCrossValidationResult[]
  verification: AuditVerification | null
  /** Gap 4 — HMAC of the package's core contents; the verifiable integrity hash. */
  packageIntegrityHash: string
  verificationInstructions: VerificationInstructions
}

export function generateAuditPackage(input: AuditPackageInput): AuditPackage {
  const tierACount = input.dataRecords.filter((r) => r.trustTier === 'A').length
  const tierBCount = input.dataRecords.filter((r) => r.trustTier === 'B').length
  const tierCCount = input.dataRecords.filter((r) => r.trustTier === 'C').length
  const passCount = input.crossValidationResults.filter((r) => r.passed).length
  const failCount = input.crossValidationResults.filter((r) => !r.passed).length

  const summary: AuditPackageSummary = {
    totalRecords: input.dataRecords.length,
    tierACount,
    tierBCount,
    tierCCount,
    sourceDocumentCount: input.sourceDocuments.length,
    crossValidationPassCount: passCount,
    crossValidationFailCount: failCount,
  }

  const verification = input.verification ?? null

  // Gap 4 — integrity hash over the package's core content (everything that
  // matters for provenance), excluding the hash and instructions themselves.
  const core = {
    entityId: input.entityId,
    entityName: input.entityName,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    summary,
    dataRecords: input.dataRecords.map((r) => ({
      ...r,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
    })),
    sourceDocuments: input.sourceDocuments.map((d) => ({
      ...d,
      submittedAt: d.submittedAt.toISOString(),
    })),
    crossValidationResults: input.crossValidationResults,
    verification,
  }
  const packageIntegrityHash = computePackageHash(core)

  const endpoint = input.publicVerifyEndpoint ?? '/api/audit/verify-public'

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    generatedAt: input.generatedAt,
    summary,
    dataRecords: input.dataRecords,
    sourceDocuments: input.sourceDocuments,
    crossValidationResults: input.crossValidationResults,
    verification,
    packageIntegrityHash,
    verificationInstructions: {
      description:
        'To independently verify this package, send a GET request to the endpoint below with the packageIntegrityHash.',
      endpoint,
      params: { packageHash: packageIntegrityHash, entityId: input.entityId },
      expectedResponse: { verified: true },
    },
  }
}
