// Tell the buyer who disputed a supplier's value how the supplier settled it:
// kept with a note, or corrected. Only while the buyer can still see the record,
// by the same field-aware grant rule every buyer read path uses, since the note
// is the supplier's data. Runs after the write commits; callers treat a failure
// as non-fatal.
import type { DataDomain } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import { fieldLabel } from '@/lib/layer3/field-label'
import { GRANT_SCOPE_SELECT, anyGrantCoversRecord, toGrantScope } from '@/lib/layer3/grant-scope'
import { periodLabel } from '@/lib/review/flagged-records'

export async function tellDisputingBuyer(input: {
  supplierEntityId: string
  buyerEntityId: string
  record: { fieldName: string; domain: DataDomain; periodStart: Date; periodEnd: Date }
  outcome: 'kept' | 'corrected'
  note?: string
}): Promise<boolean> {
  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      grantorEntityId: input.supplierEntityId,
      granteeEntityId: input.buyerEntityId,
      isActive: true,
      revokedAt: null,
    },
    select: GRANT_SCOPE_SELECT,
  })
  if (!anyGrantCoversRecord(grants.map(toGrantScope), input.record)) return false

  const supplier = await prisma.entity.findUnique({
    where: { id: input.supplierEntityId },
    select: { legalName: true },
  })
  await sendNotification({
    entityId: input.buyerEntityId,
    type: 'BUYER_DISPUTE_ANSWERED',
    payload: {
      supplierName: supplier?.legalName ?? 'A supplier',
      fieldLabel: fieldLabel(input.record.fieldName, input.record.domain),
      period: periodLabel(input.record.periodStart, input.record.periodEnd),
      outcome: input.outcome,
      note: input.note ?? null,
    },
  })
  return true
}
