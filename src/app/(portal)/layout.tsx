import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { Nav } from '@/components/Nav'
import { VerifyEmailReminder } from '@/components/VerifyEmailReminder'
import { colours } from '@/lib/design-system'
import { showsCbam } from '@/lib/nav'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // requirePageSession re-reads the user on every render: it rejects deactivated
  // and revoked sessions, sends an unenrolled admin to /security-setup, and returns
  // role/entityId from the database rather than the JWT.
  const session = await requirePageSession()

  const entityId = getSessionUser(session).entityId as string | undefined
  const account = await prisma.user.findUnique({
    where: { id: getSessionUser(session).id as string },
    select: {
      email: true,
      emailVerifiedAt: true,
      isPlatformAdmin: true,
      _count: { select: { emailVerificationTokens: true } },
    },
  })

  let entityName = 'Your organisation'
  let entityType: 'SUPPLIER' | 'BUYER' = 'SUPPLIER'
  let recordCount: number | undefined
  let showCbam = false
  if (entityId) {
    const [entity, count, cbamDocuments] = await Promise.all([
      prisma.entity.findUnique({
        where: { id: entityId },
        select: {
          legalName: true,
          entityType: true,
          cbamEnabled: true,
          _count: { select: { cbamCaseLinks: true } },
        },
      }),
      prisma.dataRecord.count({ where: { entityId, isActive: true } }),
      // A customs or CBAM declaration is CBAM activity. A supplier invoice is
      // not on its own: most organisations upload those with no CBAM goods.
      prisma.document.count({
        where: { entityId, documentType: { in: ['CUSTOMS_DECLARATION', 'CBAM_DECLARATION'] } },
      }),
    ])
    if (entity) {
      entityName = entity.legalName
      entityType = entity.entityType as 'SUPPLIER' | 'BUYER'
      showCbam = showsCbam({
        enabled: entity.cbamEnabled,
        cbamDocuments,
        caseLinks: entity._count.cbamCaseLinks,
      })
    }
    recordCount = count
  }

  return (
    <div
      style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: colours.background }}
    >
      <Nav
        entityName={entityName}
        entityType={entityType}
        recordCount={recordCount}
        showCbam={showCbam}
        isPlatformAdmin={account?.isPlatformAdmin ?? false}
      />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '40px' }}>
        {account && !account.emailVerifiedAt && (
          <VerifyEmailReminder email={account.email} linkSent={account._count.emailVerificationTokens > 0} />
        )}
        {children}
      </main>
    </div>
  )
}
