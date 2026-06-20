import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'

// Gap 4 — landing page listing the entities an auditor is scoped to.
export default async function AuditorHome() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const userId = (session.user as Record<string, unknown>).id as string

  const grants = await prisma.auditorAccess.findMany({
    where: { auditorUserId: userId, expiresAt: { gt: new Date() } },
    include: { entity: { select: { legalName: true } } },
    orderBy: { grantedAt: 'desc' },
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
        Audit access
      </h1>

      {grants.length === 0 ? (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
          You have no active audit access. Access is granted by an Arbor administrator and is scoped to a specific entity and period.
        </p>
      ) : (
        <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', overflow: 'hidden' }}>
          {grants.map((g, i) => (
            <Link
              key={g.id}
              href={`/auditor/${g.entityId}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: `${spacing[2]} ${spacing[3]}`,
                borderBottom: i < grants.length - 1 ? `1px solid ${colours.border}` : 'none',
                textDecoration: 'none',
              }}
            >
              <div>
                <div style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                  {g.entity.legalName}
                </div>
                <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                  {fmt(g.periodStart)} – {fmt(g.periodEnd)} · access expires {fmt(g.expiresAt)}
                </div>
              </div>
              <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.navy }}>
                View package →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
