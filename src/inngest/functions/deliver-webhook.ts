import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { signWebhookPayload } from '@/lib/webhooks/signing'
import { decryptSecret } from '@/lib/crypto/credential-encryption'

// Gap 6.3 — deliver a single webhook to one subscription, signed with HMAC.
// Inngest retries on throw (up to `retries`); final failure marks the subscription.
export const deliverWebhookFunction = inngest.createFunction(
  { id: 'deliver-webhook', retries: 3, concurrency: { limit: 10 }, triggers: [{ event: 'webhook/deliver' }] },
  async ({ event, step }) => {
    const { subscriptionId, payload } = event.data as { subscriptionId: string; payload: Record<string, unknown> }

    const sub = await step.run('load-subscription', async () =>
      prisma.webhookSubscription.findUnique({ where: { id: subscriptionId } }),
    )
    if (!sub || !sub.isActive) return { skipped: true }

    const body = JSON.stringify(payload)
    let secret: string
    try {
      secret = decryptSecret(sub.secretEncrypted)
    } catch {
      return { skipped: true, reason: 'secret_decrypt_failed' }
    }
    const signature = signWebhookPayload(secret, body)

    // The fetch itself is the retryable unit. A non-2xx throws so Inngest retries.
    const status = await step.run('post', async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Arbor-Signature': signature },
          body,
          signal: controller.signal,
        })
        return String(res.status)
      } finally {
        clearTimeout(timeout)
      }
    })

    await step.run('record-status', async () => {
      await prisma.webhookSubscription.update({
        where: { id: subscriptionId },
        data: { lastDeliveryAt: new Date(), lastDeliveryStatus: status },
      })
    })

    return { delivered: true, status }
  },
)
