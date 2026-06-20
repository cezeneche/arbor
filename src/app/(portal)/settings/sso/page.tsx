import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { SsoSetup } from './SsoSetup'

export default async function SsoSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = (session.user as Record<string, unknown>).role as string
  if (role !== 'ADMIN') redirect('/settings')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { workosOrganisationId: true },
  })

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
          Single sign-on
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
          Connect your identity provider (Okta, Azure AD, Google Workspace) through WorkOS so your team signs in with your company account. Users are provisioned automatically on first sign-in.
        </p>
      </div>

      <SsoSetup initialOrgId={entity?.workosOrganisationId ?? null} />
    </div>
  )
}
