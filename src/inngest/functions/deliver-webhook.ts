import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { signWebhookPayload } from '@/lib/webhooks/signing'
import { decryptSecret } from '@/lib/crypto/credential-encryption'
import { safeFetch, OutboundRequestError } from '@/lib/net/safe-fetch'

// deliver a single webhook to one subscription, signed with HMAC.
// Inngest retries on throw (up to `retries`); final failure marks the subscription.
export const deliverWebhookFunction = inngest.createFunction(
  { id: 'deliver-webhook', retries: 3, concurrency: { limit: 5 }, triggers: [{ event: 'webhook/deliver' }] },
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

    // The fetch is the retryable unit, and a non-2xx really does throw: the
    // endpoint rejecting a delivery is a failed delivery, so Inngest must retry it
    // rather than us filing "500" as an outcome and moving on.
    //
    // safeFetch re-checks the destination on every attempt (a subscription created
    // against a public host can be re-pointed at a private one by changing DNS),
    // follows redirects only to addresses that pass the same check, and caps both
    // the time and the amount of body it will read back.
    let status: string
    try {
      status = await step.run('post', async () => {
        const res = await safeFetch(sub.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Arbor-Signature': signature },
          body,
          timeoutMs: 10_000,
          maxBytes: 64_000,
        })
        if (!res.ok) throw new Error(`Webhook endpoint returned ${res.status}`)
        return String(res.status)
      })
    } catch (e) {
      // Record the attempt before rethrowing, so a subscription failing every retry
      // still shows its last status in the UI rather than looking untouched.
      const reason =
        e instanceof OutboundRequestError ? `blocked: ${e.reason}` : (e as Error).message
      await step.run('record-failure', async () => {
        await prisma.webhookSubscription.update({
          where: { id: subscriptionId },
          data: { lastDeliveryAt: new Date(), lastDeliveryStatus: reason.slice(0, 120) },
        })
      })
      // A destination that is not reachable by policy will never become reachable
      // by retrying, so it is a terminal outcome, not a transient one.
      if (e instanceof OutboundRequestError) return { delivered: false, reason: e.reason }
      throw e
    }

    await step.run('record-status', async () => {
      await prisma.webhookSubscription.update({
        where: { id: subscriptionId },
        data: { lastDeliveryAt: new Date(), lastDeliveryStatus: status },
      })
    })

    return { delivered: true, status }
  },
)
