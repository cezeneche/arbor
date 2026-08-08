// Layer 3  -  packaging only. No calculation logic. No DB reads. No API calls.
// Assembles DataRecords, source documents, audit chain, and cross-validation results
// into a structured JSON package for third-party verification (Bureau Veritas, SGS, EY, etc.)
import { computePackageHash } from '@/lib/layer2/verification-signature'
import {
  merkleRoot,
  buildInclusionProof,
  verifyInclusionProof,
  type MerkleInclusionProof,
} from '@/lib/layer2/merkle'

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
  // the record's HMAC auditHash. Doubles as its Merkle leaf.
  auditHash: string
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

// third-party verification status carried in the package.
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
  /** present when an assigned verifier has signed off this entity+period. */
  verification?: AuditVerification | null
  /** public verify endpoint embedded in the package's instructions. */
  publicVerifyEndpoint?: string
}

// instructions an external auditor can follow to verify the package
// without an Arbor account.
//
// Verification means recomputing the integrity hash from the package they are
// holding and asking Arbor whether that hash was ever issued. Sending the hash
// alone proves only that some package with that hash existed — it says nothing
// about the file in the auditor's hands, which is the thing under suspicion.
export interface VerificationInstructions {
  description: string
  endpoint: string
  method: 'POST'
  /** Post the package itself; the endpoint recomputes its hash from the contents. */
  body: { package: 'the full package JSON, unmodified' }
  expectedResponse: { contentsMatchHash: true; hashIssuedByArbor: true }
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

// the Merkle commitment carried in the package. The root commits the
// ordered per-record auditHash leaves; each proof lets an auditor recompute the
// root for one record offline, without seeing the rest of the corpus.
export interface AuditRecordInclusionProof {
  recordId: string
  proof: MerkleInclusionProof
}

export interface AuditMerkleCommitment {
  algorithm: 'RFC6962-SHA256'
  root: string
  leafCount: number
  inclusionProofs: AuditRecordInclusionProof[]
  /** True when every emitted proof recomputes to the committed root. */
  consistent: boolean
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
  /** HMAC of the package's core contents; the verifiable integrity hash. */
  packageIntegrityHash: string
  /** Merkle-DAG commitment over the record auditHashes. */
  merkle: AuditMerkleCommitment
  verificationInstructions: VerificationInstructions
}

// build the Merkle root + one inclusion proof per record. Kept pure
// (Node crypto only), like the integrity hash. The root is deliberately NOT
// folded into packageIntegrityHash: it is an additive commitment, so existing
// package hashes (and the public-verify records that store them) are unchanged.
function buildMerkleCommitment(records: AuditDataRecord[]): AuditMerkleCommitment {
  const leaves = records.map((r) => r.auditHash)
  const root = merkleRoot(leaves)
  const inclusionProofs = records.map((r, i) => ({
    recordId: r.id,
    proof: buildInclusionProof(leaves, i),
  }))
  return {
    algorithm: 'RFC6962-SHA256',
    root,
    leafCount: leaves.length,
    inclusionProofs,
    consistent: inclusionProofs.every((p) => verifyInclusionProof(p.proof)),
  }
}

/** The exact content the integrity hash covers: everything that matters for
 *  provenance, excluding the hash and the instructions themselves.
 *
 *  Both generation and verification build it here, from the same code, so a
 *  recomputation over a submitted package is comparing like with like. Dates are
 *  normalised to ISO strings because a package that has been through JSON no
 *  longer carries Date objects. computePackageHash sorts keys recursively, so key
 *  order is not part of the commitment. */
export function buildPackageCore(input: {
  entityId: string
  entityName: string
  periodStart: Date | string
  periodEnd: Date | string
  summary: AuditPackageSummary
  dataRecords: Array<Omit<AuditDataRecord, 'periodStart' | 'periodEnd'> & {
    periodStart: Date | string
    periodEnd: Date | string
  }>
  sourceDocuments: Array<Omit<AuditSourceDocument, 'submittedAt'> & { submittedAt: Date | string }>
  crossValidationResults: AuditCrossValidationResult[]
  verification: AuditVerification | null
}): unknown {
  const iso = (d: Date | string) => (typeof d === 'string' ? new Date(d).toISOString() : d.toISOString())

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    periodStart: iso(input.periodStart),
    periodEnd: iso(input.periodEnd),
    summary: input.summary,
    dataRecords: input.dataRecords.map(r => ({
      ...r,
      periodStart: iso(r.periodStart),
      periodEnd: iso(r.periodEnd),
    })),
    sourceDocuments: input.sourceDocuments.map(d => ({
      ...d,
      submittedAt: iso(d.submittedAt),
    })),
    crossValidationResults: input.crossValidationResults,
    verification: input.verification,
  }
}

export function computePackageIntegrityHash(input: Parameters<typeof buildPackageCore>[0]): string {
  return computePackageHash(buildPackageCore(input))
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

  const packageIntegrityHash = computePackageIntegrityHash({
    entityId: input.entityId,
    entityName: input.entityName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    summary,
    dataRecords: input.dataRecords,
    sourceDocuments: input.sourceDocuments,
    crossValidationResults: input.crossValidationResults,
    verification,
  })

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
    merkle: buildMerkleCommitment(input.dataRecords),
    verificationInstructions: {
      description:
        'To independently verify this package, POST the whole file to the endpoint below as {"package": <this JSON>}. Arbor recomputes the integrity hash from the contents you send and reports whether that hash was one it issued. Sending the hash on its own would only confirm that some package had it — not that this file is that package.',
      endpoint,
      method: 'POST',
      body: { package: 'the full package JSON, unmodified' },
      expectedResponse: { contentsMatchHash: true, hashIssuedByArbor: true },
    },
  }
}
