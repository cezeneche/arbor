// Layer 3 — Access & Sharing. Reads stored records (read-only) and assembles
// them into a structured audit package via the pure generator. No mutation of
// stored data, no calculation. Optionally logs the package hash for public
// verification (Gap 4) — that single write is provenance bookkeeping, not a
// modification of any data record.
import { prisma } from '@/lib/prisma'
import {
  generateAuditPackage,
  type AuditPackage,
  type AuditVerification,
} from './generator'
import { verifyChain } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'

export interface AssembleOptions {
  entityId: string
  periodStart?: Date | null
  periodEnd?: Date | null
  /** When set, an AuditPackageLog row is written with the package's integrity hash. */
  logRequestedById?: string
}

export interface AssembledPackage {
  package: AuditPackage
  chainIntegrityVerified: boolean
  auditEntryCount: number
}

export async function assembleAuditPackage(opts: AssembleOptions): Promise<AssembledPackage> {
  const { entityId, periodStart, periodEnd } = opts

  const periodFilter = {
    ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
    ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
  }

  const [entity, records, auditEntries, crossValidations, verifiedAssignment] = await Promise.all([
    prisma.entity.findUniqueOrThrow({ where: { id: entityId }, select: { legalName: true } }),
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true, ...periodFilter },
      include: { document: { select: { id: true, fileName: true, documentType: true, submittedAt: true } } },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.auditEntry.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
    prisma.crossValidationResult.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
    // Gap 3 — the most recent verified sign-off covering this period, if any.
    prisma.verificationAssignment.findFirst({
      where: {
        entityId,
        status: 'VERIFIED',
        ...(periodStart ? { periodStart: { lte: periodStart } } : {}),
        ...(periodEnd ? { periodEnd: { gte: periodEnd } } : {}),
      },
      orderBy: { verifiedAt: 'desc' },
      include: { verifier: { select: { name: true } } },
    }),
  ])

  const chainEntries = auditEntries.map((e) => ({
    hash: e.hash,
    previousHash: e.previousHash,
    payload: e.payload as unknown as AuditPayload,
  }))
  const chainIntegrityVerified = verifyChain(chainEntries)

  const sourceDocMap = new Map<string, { id: string; documentType: string; fileName: string; submittedAt: Date }>()
  for (const r of records) {
    if (r.document && !sourceDocMap.has(r.document.id)) sourceDocMap.set(r.document.id, r.document)
  }

  const verification: AuditVerification | null =
    verifiedAssignment && verifiedAssignment.verifiedAt && verifiedAssignment.signatureHash
      ? {
          status: 'INDEPENDENTLY_VERIFIED',
          verifierName: verifiedAssignment.verifier.name,
          verifiedAt: verifiedAssignment.verifiedAt.toISOString(),
          signatureHash: verifiedAssignment.signatureHash,
        }
      : null

  const pkg = generateAuditPackage({
    entityId,
    entityName: entity.legalName,
    periodStart: periodStart ?? (records[0]?.periodStart ?? new Date(0)),
    periodEnd: periodEnd ?? (records[records.length - 1]?.periodEnd ?? new Date()),
    generatedAt: new Date(),
    dataRecords: records.map((r) => ({
      id: r.id,
      entityId: r.entityId,
      domain: r.domain,
      fieldName: r.fieldName,
      value: r.value,
      unit: r.unit,
      trustTier: r.trustTier,
      confidenceScore: r.confidenceScore,
      sourceText: r.sourceText,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      extractionMethod: r.extractionMethod,
      documentId: r.documentId,
    })),
    sourceDocuments: [...sourceDocMap.values()].map((d) => ({
      id: d.id,
      documentType: d.documentType,
      fileName: d.fileName,
      submittedAt: d.submittedAt,
      trustTier: 'A' as const,
    })),
    crossValidationResults: crossValidations.map((c) => ({
      id: c.id,
      documentAId: c.documentAId,
      documentBId: c.documentBId,
      fieldName: c.fieldName,
      valueA: c.valueA,
      valueB: c.valueB,
      discrepancyPercent: c.discrepancyPercent,
      passed: c.passed,
    })),
    verification,
  })

  if (opts.logRequestedById) {
    await prisma.auditPackageLog.create({
      data: {
        entityId,
        periodStart: pkg.periodStart,
        periodEnd: pkg.periodEnd,
        packageHash: pkg.packageIntegrityHash,
        requestedById: opts.logRequestedById,
      },
    })
  }

  return { package: pkg, chainIntegrityVerified, auditEntryCount: auditEntries.length }
}
