import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { spacing, textStyles } from '@/lib/design-system'
import { IntegrationManager } from './IntegrationManager'
import { BackLink } from '@/components/BackLink'

export default async function IntegrationsPage() {
  const session = await requirePageSession()
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
      <BackLink current="ERP & customs integrations" />
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>
          ERP &amp; customs integrations
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          Connect your customs or ERP system to pull operational data automatically. Records arrive as Declared (Tier B); submit the source documents to upgrade them to Verified.
        </p>
      </div>

      <IntegrationManager initialStatus={status} />
    </div>
  )
}
