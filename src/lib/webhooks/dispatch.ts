// Gap 6 — fan a domain event out to the webhook subscriptions that should
// receive it, enqueuing one Inngest delivery per subscription.
import { prisma } from '@/lib/prisma'
import { inngest } from '@/inngest/client'

export type WebhookEvent = 'record.certified' | 'record.superseded' | 'access.granted' | 'access.revoked'

// Map the public event name to the stored enum value.
const EVENT_ENUM: Record<WebhookEvent, string> = {
  'record.certified': 'RECORD_CERTIFIED',
  'record.superseded': 'RECORD_SUPERSEDED',
  'access.granted': 'ACCESS_GRANTED',
  'access.revoked': 'ACCESS_REVOKED',
}

// Deliver `event` to every active subscription on `recipientEntityId` that
// includes the event type. Best-effort; never throws into the caller.
export async function dispatchWebhook(
  recipientEntityId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const subs = await prisma.webhookSubscription.findMany({
      where: { entityId: recipientEntityId, isActive: true },
      select: { id: true, events: true },
    })
    const enumValue = EVENT_ENUM[event]
    const matching = subs.filter((s) => Array.isArray(s.events) && (s.events as string[]).includes(enumValue))
    if (matching.length === 0) return

    const payload = { event, ...data, occurredAt: new Date().toISOString() }
    await inngest.send(
      matching.map((s) => ({ name: 'webhook/deliver', data: { subscriptionId: s.id, payload } })),
    )
  } catch (e) {
    console.error('[webhooks] dispatch failed:', e)
  }
}
