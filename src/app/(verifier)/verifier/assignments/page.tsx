import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'

const STATUS_GROUPS = [
  { key: 'PENDING', label: 'Awaiting review' },
  { key: 'IN_REVIEW', label: 'In review' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'REJECTED', label: 'Rejected' },
] as const

const STATUS_COLOUR: Record<string, string> = {
  PENDING: colours.amber,
  IN_REVIEW: colours.navy,
  VERIFIED: colours.green,
  REJECTED: colours.red,
}

export default async function VerifierAssignmentsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const verifierId = (session.user as Record<string, unknown>).id as string

  const assignments = await prisma.verificationAssignment.findMany({
    where: { verifierId },
    include: { entity: { select: { legalName: true } } },
    orderBy: { assignedAt: 'desc' },
  })

  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div>
      <h1
        style={{
          fontSize: typography.sizes.lg,
          fontWeight: typography.weights.medium,
          color: colours.textPrimary,
          margin: `0 0 ${spacing[4]}`,
          letterSpacing: typography.tracking.tight,
        }}
      >
        Verification assignments
      </h1>

      {assignments.length === 0 && (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
          You have no verification assignments yet.
        </p>
      )}

      {STATUS_GROUPS.map((group) => {
        const rows = assignments.filter((a) => a.status === group.key)
        if (rows.length === 0) return null
        return (
          <section key={group.key} style={{ marginBottom: spacing[4] }}>
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: colours.textSecondary,
                letterSpacing: typography.tracking.wider,
                textTransform: 'uppercase' as const,
                display: 'block',
                marginBottom: spacing[1],
              }}
            >
              {group.label}
            </span>
            <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', overflow: 'hidden' }}>
              {rows.map((a, i) => (
                <Link
                  key={a.id}
                  href={`/verifier/assignments/${a.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: `${spacing[2]} ${spacing[3]}`,
                    borderBottom: i < rows.length - 1 ? `1px solid ${colours.border}` : 'none',
                    textDecoration: 'none',
                  }}
                >
                  <div>
                    <div style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                      {a.entity.legalName}
                    </div>
                    <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                      {fmt(a.periodStart)} – {fmt(a.periodEnd)} · assigned {fmt(a.assignedAt)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: STATUS_COLOUR[a.status],
                      letterSpacing: typography.tracking.wide,
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    {a.status.replace('_', ' ')}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
