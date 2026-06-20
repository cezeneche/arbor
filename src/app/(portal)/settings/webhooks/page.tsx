import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { WebhookManager } from './WebhookManager'

export default async function WebhooksPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = (session.user as Record<string, unknown>).role as string
  if (role !== 'ADMIN') redirect('/settings')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const subs = await prisma.webhookSubscription.findMany({
    where: { entityId },
    select: {
      id: true, url: true, events: true, secretPrefix: true, isActive: true,
      createdAt: true, lastDeliveryAt: true, lastDeliveryStatus: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const serialised = subs.map((s) => ({
    id: s.id,
    url: s.url,
    events: (s.events as string[]) ?? [],
    secretPrefix: s.secretPrefix,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
    lastDeliveryAt: s.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryStatus: s.lastDeliveryStatus,
  }))

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Webhooks
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Receive a signed HTTP callback when a certified record, supersession, or access change occurs for a supplier you can see. Verify the <code>X-Arbor-Signature</code> header with your signing secret.
        </p>
      </div>

      <WebhookManager initialSubscriptions={serialised} />
    </div>
  )
}
