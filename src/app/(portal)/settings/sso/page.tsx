import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { SsoSetup } from './SsoSetup'

export default async function SsoSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = getSessionUser(session).role
  if (role !== 'ADMIN') redirect('/settings')
  const entityId = getSessionUser(session).entityId as string

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { workosOrganisationId: true },
  })

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>
          Single sign-on
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          Connect your identity provider (Okta, Azure AD, Google Workspace) through WorkOS so your team signs in with your company account. Users are provisioned automatically on first sign-in.
        </p>
      </div>

      <SsoSetup initialOrgId={entity?.workosOrganisationId ?? null} />
    </div>
  )
}
