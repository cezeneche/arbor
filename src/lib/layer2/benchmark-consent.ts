// Layer 2 — sets an entity's benchmark-aggregation consent flag and records the
// grant/revocation in the HMAC audit chain (PRD §19.3). This is the single source
// of truth for the mutation so the two API routes that expose it (settings and
// entity-scoped) cannot drift on authorization or audit logging.
import { type AuditPayload } from '@/lib/layer2/audit-chain'
import { appendAuditEntry } from '@/lib/layer2/audit-append'
import { runSerializable } from '@/lib/layer2/serializable'

export async function setBenchmarkConsent(
  entityId: string,
  userId: string,
  allow: boolean,
): Promise<void> {
  // The flag and its audit entry move together. Splitting them left a window in
  // which the entity's data was opted in with nothing in the chain saying who
  // decided that, or the reverse.
  await runSerializable(async tx => {
    await tx.entity.update({
      where: { id: entityId },
      data: { allowBenchmarkAggregation: allow },
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

    await appendAuditEntry(tx, {
      entityId,
      recordId,
      eventType: allow ? 'BENCHMARK_CONSENT_GRANTED' : 'BENCHMARK_CONSENT_REVOKED',
      payload,
    })
  })
}
