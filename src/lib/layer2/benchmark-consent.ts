// Layer 2 — sets an entity's benchmark-aggregation consent flag and records the
// grant/revocation in the HMAC audit chain (PRD §19.3). This is the single source
// of truth for the mutation so the two API routes that expose it (settings and
// entity-scoped) cannot drift on authorization or audit logging.
import { prisma } from '@/lib/prisma'
import { computeRecordHash, type AuditPayload } from '@/lib/layer2/audit-chain'
import type { Prisma } from '@prisma/client'

export async function setBenchmarkConsent(
  entityId: string,
  userId: string,
  allow: boolean,
): Promise<void> {
  await prisma.entity.update({
    where: { id: entityId },
    data: { allowBenchmarkAggregation: allow },
  })

  const lastEntry = await prisma.auditEntry.findFirst({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })

  // recordId is assigned once and reused for both hash computation and storage.
  const recordId = `consent_${Date.now()}`
  const now = new Date().toISOString()
  const payload: AuditPayload = {
    recordId,
    entityId,
    domain: 'COMPLIANCE',
    fieldName: 'benchmark_aggregation_consent',
    value: allow ? 1 : 0,
    unit: 'boolean',
    originalValue: allow ? 1 : 0,
    originalUnit: 'boolean',
    periodStart: now,
    periodEnd: now,
    trustTier: 'B',
    confidenceScore: 1.0,
    sourceText: null,
    documentId: null,
    extractionMethod: 'MANUAL_ENTRY',
    submittedAt: now,
    submittedById: userId,
  }
  const hash = computeRecordHash(payload, lastEntry?.hash ?? null)

  await prisma.auditEntry.create({
    data: {
      entityId,
      recordId,
      eventType: allow ? 'BENCHMARK_CONSENT_GRANTED' : 'BENCHMARK_CONSENT_REVOKED',
      payload: payload as unknown as Prisma.InputJsonValue,
      hash,
      previousHash: lastEntry?.hash ?? null,
    },
  })
}
