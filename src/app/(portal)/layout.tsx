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
  if (entityId) {
    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { legalName: true },
    })
    if (entity) entityName = entity.legalName
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: colours.background }}>
      <Nav entityName={entityName} />
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 32px' }}>
        {children}
      </main>
    </div>
  )
}
