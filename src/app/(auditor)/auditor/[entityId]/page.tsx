import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { assembleAuditPackage } from '@/lib/audit-package/assemble'
import { AuditPackageView } from '@/components/AuditPackageView'

// Gap 4 — read-only audit package view for an external auditor, scoped to a
// single entity+period by their AuditorAccess grant. No actions.
export default async function AuditorEntityPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')
  const role = getSessionUser(session).role
  if (role !== 'AUDITOR') redirect('/dashboard')
  const userId = getSessionUser(session).id

  const access = await prisma.auditorAccess.findFirst({
    where: { auditorUserId: userId, entityId, expiresAt: { gt: new Date() } },
  })
  if (!access) redirect('/auditor')

  const { package: pkg, chainIntegrityVerified, auditEntryCount } = await assembleAuditPackage({
    entityId,
    periodStart: access.periodStart,
    periodEnd: access.periodEnd,
    logRequestedById: userId,
  })

  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div>
      <Link href="/auditor" style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none' }}>
        ← All audit access
      </Link>
      <h1
        style={{
          fontSize: typography.sizes.lg,
          fontWeight: typography.weights.medium,
          color: colours.textPrimary,
          margin: `${spacing[2]} 0 0`,
          letterSpacing: typography.tracking.tight,
        }}
      >
        {pkg.entityName}
      </h1>
      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 ${spacing[4]}` }}>
        Read-only audit package · {fmt(access.periodStart)} – {fmt(access.periodEnd)}
      </p>

      <AuditPackageView pkg={pkg} chainIntegrityVerified={chainIntegrityVerified} auditEntryCount={auditEntryCount} />
    </div>
  )
}
