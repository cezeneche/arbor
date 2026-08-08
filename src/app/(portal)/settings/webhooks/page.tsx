import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { spacing, textStyles } from '@/lib/design-system'
import { WebhookManager } from './WebhookManager'
import { BackLink } from '@/components/BackLink'

export default async function WebhooksPage() {
  const session = await requirePageSession()
  const role = getSessionUser(session).role
  if (role !== 'ADMIN') redirect('/settings')
  const entityId = getSessionUser(session).entityId as string

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
      <BackLink current="Webhooks" />
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>
          Webhooks
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          Receive a signed HTTP callback when a certified record, supersession, or access change occurs for a supplier you can see. Verify the <code>X-Arbor-Signature</code> header with your signing secret.
        </p>
      </div>

      <WebhookManager initialSubscriptions={serialised} />
    </div>
  )
}
