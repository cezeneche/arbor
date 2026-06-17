import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours } from '@/lib/design-system'
import { MandatoryTwoFactorSetup } from './MandatoryTwoFactorSetup'

// Mandatory 2FA enrolment for administrators. Lives outside the (portal) layout
// so the portal's "redirect admins here" guard cannot loop on this page.
export default async function SecuritySetupPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = (session.user as Record<string, unknown>).id as string
  const role = (session.user as Record<string, unknown>).role as string

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
