import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { shareState } from '@/lib/shares/share-status'
import Link from 'next/link'
import { SharesManager } from '@/components/SharesManager'

export default async function SharesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = getSessionUser(session).entityId as string

  const [shares, hdrs] = await Promise.all([
    prisma.sharedExport.findMany({ where: { entityId }, orderBy: { createdAt: 'desc' } }),
    headers(),
  ])

  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  const proto = hdrs.get('x-forwarded-proto') ?? 'https'
  const origin = host ? `${proto}://${host}` : ''

  const initial = shares.map((s) => ({
    id: s.id,
    token: s.token,
    domain: s.domain,
    periodStart: s.periodStart?.toISOString() ?? null,
    periodEnd: s.periodEnd?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt?.toISOString() ?? null,
    revokedAt: s.revokedAt?.toISOString() ?? null,
    state: shareState(s),
  }))

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[3] }}>
        <Link href="/requests" style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, textDecoration: 'none' }}>
          ← Requests
        </Link>
      </div>
      <h1 style={textStyles.pageTitle}>
        Shared links
      </h1>
      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 ${spacing[4]}`, maxWidth: '640px' }}>
        Share a set of your records as a link. Whoever opens it sees the records and their trust tiers, and can
        confirm the data hasn&apos;t been altered - without needing an Arbor account. Revoke any link at any time.
      </p>

      <SharesManager initial={initial} origin={origin} />
    </div>
  )
}
