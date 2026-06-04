import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { ApiKeyManager } from './ApiKeyManager'

export default async function ApiKeysPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const keys = await prisma.apiKey.findMany({
    where: { entityId, isActive: true },
    select: { id: true, label: true, lastUsed: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const serialised = keys.map(k => ({
    ...k,
    lastUsed: k.lastUsed?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  }))

  return (
    <div style={{ maxWidth: '680px' }}>
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
          API keys
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Use API keys to connect your accounting or ERP system to Arbor via the v1 API.
          Keys authenticate against <code style={{ fontSize: typography.sizes.sm }}>POST /api/v1/documents</code> and{' '}
          <code style={{ fontSize: typography.sizes.sm }}>GET /api/v1/records</code>.
        </p>
      </div>

      <ApiKeyManager initialKeys={serialised} />
    </div>
  )
}
