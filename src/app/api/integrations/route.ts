import { requireAdmin } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { ok } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// list the caller entity's integration status. Never returns credentials.
export async function GET() {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const creds = await prisma.integrationCredential.findMany({
    where: { entityId },
    select: { provider: true, isActive: true, createdAt: true, lastSyncAt: true, lastSyncStatus: true },
  })

  return ok({ integrations: creds })
}
