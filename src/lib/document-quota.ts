// Creating a document within the entity's monthly upload quota.
//
// The count and the create run in one serializable transaction. Counted first
// and created in a separate statement, two uploads at once both saw room for
// the last slot; in one transaction Postgres treats that as the conflict it is
// and runSerializable retries the loser, which then sees the quota full.
import type { Prisma } from '@prisma/client'
import { assertUploadAllowed, type PlanGuardClient } from '@/lib/plan-guard'
import { runSerializable, type RunSerializableOptions } from '@/lib/layer2/serializable'

export class UploadQuotaError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'UploadQuotaError'
  }
}

export async function createDocumentWithinQuota(
  data: Prisma.DocumentUncheckedCreateInput,
  opts: Pick<RunSerializableOptions, 'client'> = {},
) {
  return runSerializable(async tx => {
    const check = await assertUploadAllowed(data.entityId, tx as unknown as PlanGuardClient)
    if (!check.allowed) throw new UploadQuotaError(check.reason!)
    return tx.document.create({ data })
  }, opts)
}
