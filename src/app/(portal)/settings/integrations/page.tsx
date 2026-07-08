import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { IntegrationManager } from './IntegrationManager'

export default async function IntegrationsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = getSessionUser(session).role
  if (role !== 'ADMIN') redirect('/settings')
  const entityId = getSessionUser(session).entityId as string

  const creds = await prisma.integrationCredential.findMany({
    where: { entityId },
    select: { provider: true, isActive: true, lastSyncAt: true, lastSyncStatus: true },
  })

  const status = Object.fromEntries(
    creds.map((c) => [c.provider, {
      connected: c.isActive,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: c.lastSyncStatus,
    }]),
  )

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>
          ERP &amp; customs integrations
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Connect your customs or ERP system to pull operational data automatically. Records arrive as Declared (Tier B); submit the source documents to upgrade them to Verified.
        </p>
      </div>

      <IntegrationManager initialStatus={status} />
    </div>
  )
}
