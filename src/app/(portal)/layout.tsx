import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Nav } from '@/components/Nav'
import { colours } from '@/lib/design-system'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string | undefined

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
