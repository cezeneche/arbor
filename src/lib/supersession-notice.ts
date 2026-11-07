// Tell every buyer with active access that a supplier record they can see was
// replaced (PRD 20.3): once per buyer and domain, by notification and webhook.
// Shared by document confirmation and corrections made from Review. Runs after
// the write commits; callers treat a failure here as non-fatal.
import { prisma } from '@/lib/prisma'
import { findActiveGranteeEntityIds } from '@/lib/layer3/grant-access'
import { sendNotification } from '@/lib/notifications'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

export interface SupersededScope {
  domain: string
  periodStart: Date
  periodEnd: Date
}

export async function notifyBuyersOfSupersession(
  supplierEntityId: string,
  scopes: readonly SupersededScope[],
): Promise<void> {
  if (scopes.length === 0) return
  const supplier = await prisma.entity.findUnique({
    where: { id: supplierEntityId },
    select: { legalName: true },
  })
  const notified = new Set<string>()
  for (const scope of scopes) {
    const grantees = await findActiveGranteeEntityIds(
      supplierEntityId,
      scope.domain,
      scope.periodStart,
      scope.periodEnd,
    )
    for (const granteeEntityId of grantees) {
      const dedupKey = `${granteeEntityId}:${scope.domain}`
      if (notified.has(dedupKey)) continue
      notified.add(dedupKey)
      await sendNotification({
        entityId: granteeEntityId,
        type: 'RECORD_SUPERSEDED',
        payload: {
          supplierName: supplier?.legalName ?? 'A supplier',
          domain: scope.domain,
          periodStart: scope.periodStart.toISOString().slice(0, 10),
          periodEnd: scope.periodEnd.toISOString().slice(0, 10),
        },
      })
      await dispatchWebhook(granteeEntityId, 'record.superseded', {
        supplierEntityId,
        domain: scope.domain,
        periodStart: scope.periodStart.toISOString(),
        periodEnd: scope.periodEnd.toISOString(),
      })
    }
  }
}
