// write integration-sourced records as Tier B / SYSTEM_INTEGRATION.
// A source document submitted later upgrades them to Tier A via the tier
// upgrade pathway. Deduplicates by sourceRef stored in sourceText.
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { runSerializable } from '@/lib/layer2/serializable'
import { assertRecordCapacity } from '@/lib/plan-guard'
import { TrustTier, ExtractionMethod } from '@prisma/client'
import type { IntegrationRecord } from './mappers'

export interface SyncResult {
  created: number
  skipped: number
  /** True when the entity's plan ran out of record capacity part-way through. */
  capacityReached?: boolean
}

export async function writeIntegrationRecords(
  entityId: string,
  records: IntegrationRecord[],
): Promise<SyncResult> {
  const systemUser = await getSystemUser(entityId)
  let created = 0
  let skipped = 0

  for (const rec of records) {
    // Dedup: skip if a record with the same sourceRef already exists for this entity+field.
    const existing = await prisma.dataRecord.findFirst({
      where: { entityId, fieldName: rec.fieldName, sourceText: rec.sourceRef },
      select: { id: true },
    })
    if (existing) {
      skipped++
      continue
    }

    // Integration pulls are the easiest way to blow past a record cap — they
    // arrive in bulk and unattended — and were the one write path with no
    // capacity check at all. Counted inside the transaction that writes, so two
    // concurrent syncs cannot both see room for the last record.
    const written = await runSerializable(async (tx) => {
      const capacity = await assertRecordCapacity(entityId, 1, tx)
      if (!capacity.allowed) return null
      return writeRecordWithAuditEntry(tx, {
        entityId,
        domain: rec.domain,
        fieldName: rec.fieldName,
        value: rec.value,
        unit: rec.unit,
        originalValue: rec.value,
        originalUnit: rec.unit,
        periodStart: rec.periodStart,
        periodEnd: rec.periodEnd,
        trustTier: TrustTier.B,
        extractionMethod: ExtractionMethod.SYSTEM_INTEGRATION,
        submittedById: systemUser.id,
        sourceText: rec.sourceRef,
      })
    })

    if (!written) {
      // Out of capacity: stop rather than churning through the rest of the batch
      // producing the same refusal, and report it on the sync outcome.
      return { created, skipped, capacityReached: true }
    }
    created++
  }

  return { created, skipped }
}

export async function recordSyncOutcome(credentialId: string, status: string): Promise<void> {
  await prisma.integrationCredential.update({
    where: { id: credentialId },
    data: { lastSyncAt: new Date(), lastSyncStatus: status },
  })
}
