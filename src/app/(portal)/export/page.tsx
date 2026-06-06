import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { ExportBuilder } from './ExportBuilder'

export default async function ExportPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { entityType: true },
  })

  if (entity?.entityType !== 'BUYER') {
    redirect('/dashboard')
  }

  // Suppliers this buyer has active access grants from
  const grants = await prisma.dataAccessGrant.findMany({
    where: { granteeEntityId: entityId, isActive: true },
    select: {
      grantorEntityId: true,
      grantorEntity: { select: { legalName: true } },
      domain: true,
    },
    distinct: ['grantorEntityId'],
    orderBy: { grantorEntity: { legalName: 'asc' } },
  })

  const suppliers = grants.map(g => ({
    id: g.grantorEntityId,
    name: g.grantorEntity.legalName,
  }))

  return (
    <div style={{ maxWidth: '860px' }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Export data
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Assemble records from across your supply chain and download with full provenance.
          Trust tiers and source references are included on every record.
        </p>
      </div>

      <ExportBuilder suppliers={suppliers} buyerEntityId={entityId} />
    </div>
  )
}
