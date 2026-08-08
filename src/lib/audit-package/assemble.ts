// Layer 3 — Access & Sharing. Reads stored records (read-only) and assembles
// them into a structured audit package via the pure generator. No mutation of
// stored data, no calculation. Optionally logs the package hash for public
// verification — that single write is provenance bookkeeping, not a
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

// shadow-compare: the Merkle root and the linear HMAC chain secure
// the same leaves (DataRecord.auditHash == AuditEntry.hash), so before any
// consumer treats the root as authoritative we assert the two structures agree:
// the chain verifies, every Merkle leaf is present in the chain, and every proof
// recomputes to the root.
export interface MerkleShadowCompare {
  chainVerified: boolean
  allLeavesInChain: boolean
  proofsConsistent: boolean
  agree: boolean
}

export interface AssembledPackage {
  package: AuditPackage
  chainIntegrityVerified: boolean
  auditEntryCount: number
  merkleShadow: MerkleShadowCompare
}

export async function assembleAuditPackage(opts: AssembleOptions): Promise<AssembledPackage> {
  const { entityId, periodStart, periodEnd } = opts

  const periodFilter = {
    ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
    ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
  }

  const [entity, records, auditEntries, allCrossValidations, verifiedAssignment] = await Promise.all([
    prisma.entity.findUniqueOrThrow({ where: { id: entityId }, select: { legalName: true } }),
    prisma.dataRecord.findMany({
      where: { entityId, isActive: true, ...periodFilter },
      include: { document: { select: { id: true, fileName: true, documentType: true, submittedAt: true } } },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.auditEntry.findMany({ where: { entityId }, orderBy: { sequence: 'asc' } }),
    prisma.crossValidationResult.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
    // the most recent verified sign-off covering this period, if any.
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

  // A package scoped to a period must not carry cross-validation results about
  // documents outside it. CrossValidationResult has no period of its own, so the
  // scope is inherited from the documents it compares: a result belongs in the
  // package only when at least one side is a document the package already
  // includes. Without this, a Q1 package handed to one auditor disclosed
  // discrepancies found in every other quarter.
  const inScopeDocumentIds = new Set(
    records.map(r => r.documentId).filter((id): id is string => id !== null),
  )
  const crossValidations =
    periodStart || periodEnd
      ? allCrossValidations.filter(
          c => inScopeDocumentIds.has(c.documentAId) || inScopeDocumentIds.has(c.documentBId),
        )
      : allCrossValidations

  const chainEntries = auditEntries.map((e) => ({
    hash: e.hash,
    previousHash: e.previousHash,
    payload: e.payload as unknown as AuditPayload,
  }))
  const chainIntegrityVerified = verifyChain(chainEntries)

  // A source document's tier is the tier of the records that came out of it, not
  // a constant. A document whose extraction was downgraded to Declared was still
  // being listed as Verified in the package, which is precisely the claim the tier
  // system exists to stop anyone making. Where one document backs records at more
  // than one tier, the package reports the weakest — a package should never
  // overstate what it can support.
  const TIER_STRENGTH = { A: 3, B: 2, C: 1 } as const
  type Tier = keyof typeof TIER_STRENGTH

  const sourceDocMap = new Map<
    string,
    { id: string; documentType: string; fileName: string; submittedAt: Date; trustTier: Tier }
  >()
  for (const r of records) {
    if (!r.document) continue
    const tier = r.trustTier as Tier
    const existing = sourceDocMap.get(r.document.id)
    if (!existing) {
      sourceDocMap.set(r.document.id, { ...r.document, trustTier: tier })
    } else if (TIER_STRENGTH[tier] < TIER_STRENGTH[existing.trustTier]) {
      existing.trustTier = tier
    }
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

  // With no explicit period the package covers everything it contains, so the
  // header has to be the true extent of the records — the earliest start and the
  // latest end. The records are ordered by submittedAt, so taking the first and
  // last rows described the order they were uploaded in, not the period they
  // cover: a backdated document made the package claim a period it did not span.
  const derivedPeriodStart = records.length
    ? new Date(Math.min(...records.map(r => r.periodStart.getTime())))
    : new Date(0)
  const derivedPeriodEnd = records.length
    ? new Date(Math.max(...records.map(r => r.periodEnd.getTime())))
    : new Date()

  const pkg = generateAuditPackage({
    entityId,
    entityName: entity.legalName,
    periodStart: periodStart ?? derivedPeriodStart,
    periodEnd: periodEnd ?? derivedPeriodEnd,
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
      auditHash: r.auditHash,
    })),
    sourceDocuments: [...sourceDocMap.values()].map((d) => ({
      id: d.id,
      documentType: d.documentType,
      fileName: d.fileName,
      submittedAt: d.submittedAt,
      trustTier: d.trustTier,
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

  // shadow-compare the Merkle commitment against the linear chain.
  const chainHashes = new Set(auditEntries.map((e) => e.hash))
  const allLeavesInChain = pkg.dataRecords.every((r) => chainHashes.has(r.auditHash))
  const merkleShadow: MerkleShadowCompare = {
    chainVerified: chainIntegrityVerified,
    allLeavesInChain,
    proofsConsistent: pkg.merkle.consistent,
    agree: chainIntegrityVerified && allLeavesInChain && pkg.merkle.consistent,
  }

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
    // Persist the committed root so a later verifier can confirm it existed at
    // generation time. Additive provenance bookkeeping — not a data mutation.
    await prisma.merkleRoot.create({
      data: {
        entityId,
        root: pkg.merkle.root,
        leafCount: pkg.merkle.leafCount,
        algorithm: pkg.merkle.algorithm,
        periodStart: pkg.periodStart,
        periodEnd: pkg.periodEnd,
        packageHash: pkg.packageIntegrityHash,
      },
    })
  }

  return {
    package: pkg,
    chainIntegrityVerified,
    auditEntryCount: auditEntries.length,
    merkleShadow,
  }
}
