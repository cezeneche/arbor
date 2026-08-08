// Verification of a package somebody is holding, as opposed to verification of a
// hash somebody is quoting. Pure: no DB, no network, no AI.
//
// The distinction is the whole point. Confirming that a hash appears in Arbor's
// log says a package with that hash was issued; it says nothing about the file in
// front of the auditor, which is exactly the thing they are checking. So the
// contents are re-hashed here and compared to the hash the file claims for itself.
import { z } from 'zod'
import { computePackageIntegrityHash } from './generator'

const isoDate = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'not a date')

const recordSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  domain: z.string(),
  fieldName: z.string(),
  value: z.number(),
  unit: z.string(),
  trustTier: z.enum(['A', 'B', 'C']),
  confidenceScore: z.number(),
  sourceText: z.string().nullable(),
  periodStart: isoDate,
  periodEnd: isoDate,
  extractionMethod: z.string(),
  documentId: z.string().nullable(),
  auditHash: z.string(),
})

const documentSchema = z.object({
  id: z.string(),
  documentType: z.string(),
  fileName: z.string(),
  submittedAt: isoDate,
  trustTier: z.enum(['A', 'B', 'C']),
})

const crossValidationSchema = z.object({
  id: z.string(),
  documentAId: z.string(),
  documentBId: z.string(),
  fieldName: z.string(),
  valueA: z.number(),
  valueB: z.number(),
  discrepancyPercent: z.number(),
  passed: z.boolean(),
})

const verificationSchema = z
  .object({
    status: z.enum(['INDEPENDENTLY_VERIFIED', 'REJECTED']),
    verifierName: z.string(),
    verifiedAt: z.string(),
    signatureHash: z.string(),
  })
  .nullable()

export const submittedPackageSchema = z.object({
  entityId: z.string().min(1),
  entityName: z.string(),
  periodStart: isoDate,
  periodEnd: isoDate,
  summary: z.object({
    totalRecords: z.number(),
    tierACount: z.number(),
    tierBCount: z.number(),
    tierCCount: z.number(),
    sourceDocumentCount: z.number(),
    crossValidationPassCount: z.number(),
    crossValidationFailCount: z.number(),
  }),
  dataRecords: z.array(recordSchema),
  sourceDocuments: z.array(documentSchema),
  crossValidationResults: z.array(crossValidationSchema),
  verification: verificationSchema.default(null),
  packageIntegrityHash: z.string().min(1),
})

export type SubmittedPackage = z.infer<typeof submittedPackageSchema>

export type SubmittedPackageVerdict =
  | { ok: false; reason: 'malformed' }
  | {
      ok: true
      /** The hash the submitted contents actually produce. */
      recomputedHash: string
      /** The hash the file claims for itself. */
      claimedHash: string
      /** False means the contents were changed after Arbor produced them. */
      contentsMatchHash: boolean
      entityId: string
    }

export function verifySubmittedPackage(input: unknown): SubmittedPackageVerdict {
  const parsed = submittedPackageSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'malformed' }

  const pkg = parsed.data
  const recomputedHash = computePackageIntegrityHash({
    entityId: pkg.entityId,
    entityName: pkg.entityName,
    periodStart: pkg.periodStart,
    periodEnd: pkg.periodEnd,
    summary: pkg.summary,
    dataRecords: pkg.dataRecords,
    sourceDocuments: pkg.sourceDocuments,
    crossValidationResults: pkg.crossValidationResults,
    verification: pkg.verification,
  })

  return {
    ok: true,
    recomputedHash,
    claimedHash: pkg.packageIntegrityHash,
    contentsMatchHash: recomputedHash === pkg.packageIntegrityHash,
    entityId: pkg.entityId,
  }
}
