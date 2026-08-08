import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { colours } from '@/lib/design-system'
import { MandatoryTwoFactorSetup } from './MandatoryTwoFactorSetup'

// Mandatory 2FA enrolment for administrators. Lives outside the (portal) layout
// so the portal's "redirect admins here" guard cannot loop on this page.
export default async function SecuritySetupPage() {
  // exempt: this page IS the enrolment surface, so the admin-2FA gate must not
  // bounce an unenrolled admin back here in a loop.
  const session = await requirePageSession({ exemptAdminTwoFactorSetup: true })

  const userId = getSessionUser(session).id
  const role = getSessionUser(session).role

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  })
  if (!me) redirect('/login')

  // Only unenrolled admins belong here. Everyone else goes to the app;
  // non-admins manage optional 2FA from Settings.
  if (me.twoFactorEnabled || role !== 'ADMIN') redirect('/dashboard')

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colours.background,
        padding: '24px',
      }}
    >
      <MandatoryTwoFactorSetup />
    </div>
  )
}
