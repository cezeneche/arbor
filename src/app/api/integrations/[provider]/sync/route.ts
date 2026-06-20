import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { inngest } from '@/inngest/client'
import type { IntegrationProvider } from '@prisma/client'

const PROVIDERS = ['CDS', 'SAP', 'NETSUITE', 'ORACLE'] as const

// Gap 9.6 — trigger an on-demand sync for a connected provider.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const upper = (await params).provider.toUpperCase()
  if (!(PROVIDERS as readonly string[]).includes(upper)) return err('Unknown provider', 'NOT_FOUND', 404)
  const provider = upper as IntegrationProvider

  const cred = await prisma.integrationCredential.findUnique({
    where: { entityId_provider: { entityId, provider } },
    select: { id: true, isActive: true },
  })
  if (!cred || !cred.isActive) return err('Integration not connected', 'NOT_CONNECTED', 409)

  await inngest.send({ name: 'integration/sync', data: { credentialId: cred.id, provider } })
  return ok({ ok: true, queued: true })
}
