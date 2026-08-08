import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { notFound, redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { assembleAuditPackage } from '@/lib/audit-package/assemble'
import { AuditPackageView } from '@/components/AuditPackageView'
import { VerifyActions } from './VerifyActions'

export default async function VerifierAssignmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requirePageSession()
  const verifierId = getSessionUser(session).id

  const assignment = await prisma.verificationAssignment.findUnique({
    where: { id },
    include: { entity: { select: { legalName: true } } },
  })
  if (!assignment) notFound()
  if (assignment.verifierId !== verifierId) redirect('/verifier/assignments')

  const { package: pkg, chainIntegrityVerified, auditEntryCount } = await assembleAuditPackage({
    entityId: assignment.entityId,
    periodStart: assignment.periodStart,
    periodEnd: assignment.periodEnd,
  })

  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const open = assignment.status === 'PENDING' || assignment.status === 'IN_REVIEW'

  return (
    <div>
      <Link
        href="/verifier/assignments"
        style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none' }}
      >
        ← All assignments
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
        {assignment.entity.legalName}
      </h1>
      <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 ${spacing[4]}` }}>
        Period {fmt(assignment.periodStart)} – {fmt(assignment.periodEnd)} · status {assignment.status.replace('_', ' ')}
      </p>

      <AuditPackageView pkg={pkg} chainIntegrityVerified={chainIntegrityVerified} auditEntryCount={auditEntryCount} />

      {open ? (
        <VerifyActions assignmentId={assignment.id} />
      ) : (
        <div
          style={{
            marginTop: spacing[3],
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: assignment.status === 'VERIFIED' ? colours.green : colours.red,
          }}
        >
          This assignment was {assignment.status === 'VERIFIED' ? 'verified' : 'rejected'}
          {assignment.verifiedAt ? ` on ${fmt(assignment.verifiedAt)}` : ''}.
          {assignment.verifierNote ? ` Note: ${assignment.verifierNote}` : ''}
        </div>
      )}
    </div>
  )
}
