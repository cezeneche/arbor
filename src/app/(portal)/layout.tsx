import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Nav } from '@/components/Nav'
import { colours } from '@/lib/design-system'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = getSessionUser(session).id
  const role = getSessionUser(session).role

  // Mandatory 2FA for administrators: an admin who has not yet enrolled is sent to
  // the dedicated setup page and cannot use the portal until 2FA is enabled.
  // Checked against the live DB so it clears the moment they finish enrolling.
  if (role === 'ADMIN' && userId) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    })
    if (me && !me.twoFactorEnabled) redirect('/security-setup')
  }

  const entityId = getSessionUser(session).entityId as string | undefined

  let entityName = 'Your organisation'
  let entityType: 'SUPPLIER' | 'BUYER' = 'SUPPLIER'
  let recordCount: number | undefined
  if (entityId) {
    const [entity, count] = await Promise.all([
      prisma.entity.findUnique({
        where: { id: entityId },
        select: { legalName: true, entityType: true },
      }),
      prisma.dataRecord.count({ where: { entityId, isActive: true } }),
    ])
    if (entity) {
      entityName = entity.legalName
      entityType = entity.entityType as 'SUPPLIER' | 'BUYER'
    }
    recordCount = count
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: colours.background }}>
      <Nav entityName={entityName} entityType={entityType} recordCount={recordCount} />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '40px' }}>
        {children}
      </main>
    </div>
  )
}
