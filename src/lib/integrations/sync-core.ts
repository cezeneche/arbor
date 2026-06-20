// Gap 9 — write integration-sourced records as Tier B / SYSTEM_INTEGRATION.
// A source document submitted later upgrades them to Tier A via the tier
// upgrade pathway. Deduplicates by sourceRef stored in sourceText.
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { TrustTier, ExtractionMethod } from '@prisma/client'
import type { IntegrationRecord } from './mappers'

export interface SyncResult {
  created: number
  skipped: number
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

    await prisma.$transaction(
      (tx) =>
        writeRecordWithAuditEntry(tx, {
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
        }),
      { isolationLevel: 'Serializable' },
    )
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
