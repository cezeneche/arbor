import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { spacing, textStyles } from '@/lib/design-system'
import { ExportBuilder } from './ExportBuilder'

export default async function ExportPage() {
  const session = await requirePageSession()

  const entityId = getSessionUser(session).entityId as string
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
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          Export data
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Assemble records from across your supply chain and download with full provenance.
          Trust tiers and source references are included on every record.
        </p>
      </div>

      <ExportBuilder suppliers={suppliers} buyerEntityId={entityId} />
    </div>
  )
}
