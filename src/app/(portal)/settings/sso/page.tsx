import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { spacing, textStyles } from '@/lib/design-system'
import { SsoSetup } from './SsoSetup'
import { BackLink } from '@/components/BackLink'

export default async function SsoSettingsPage() {
  const session = await requirePageSession()
  const role = getSessionUser(session).role
  if (role !== 'ADMIN') redirect('/settings')
  const entityId = getSessionUser(session).entityId as string

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { workosOrganisationId: true },
  })

  return (
    <div>
      <BackLink current="Single sign-on" />
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
