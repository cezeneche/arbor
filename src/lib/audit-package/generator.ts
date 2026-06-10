// Layer 3  -  packaging only. No calculation logic. No DB reads. No API calls.
// Assembles DataRecords, source documents, audit chain, and cross-validation results
// into a structured JSON package for third-party verification (Bureau Veritas, SGS, EY, etc.)

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

export interface AuditPackageInput {
  entityId: string
  entityName: string
  periodStart: Date
  periodEnd: Date
  dataRecords: AuditDataRecord[]
  sourceDocuments: AuditSourceDocument[]
  crossValidationResults: AuditCrossValidationResult[]
  generatedAt: Date
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
}

export function generateAuditPackage(input: AuditPackageInput): AuditPackage {
  const tierACount = input.dataRecords.filter((r) => r.trustTier === 'A').length
  const tierBCount = input.dataRecords.filter((r) => r.trustTier === 'B').length
  const tierCCount = input.dataRecords.filter((r) => r.trustTier === 'C').length
  const passCount = input.crossValidationResults.filter((r) => r.passed).length
  const failCount = input.crossValidationResults.filter((r) => !r.passed).length

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    generatedAt: input.generatedAt,
    summary: {
      totalRecords: input.dataRecords.length,
      tierACount,
      tierBCount,
      tierCCount,
      sourceDocumentCount: input.sourceDocuments.length,
      crossValidationPassCount: passCount,
      crossValidationFailCount: failCount,
    },
    dataRecords: input.dataRecords,
    sourceDocuments: input.sourceDocuments,
    crossValidationResults: input.crossValidationResults,
  }
}
