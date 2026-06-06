import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { verifyChain } from '@/lib/layer2/audit-chain'
import type { AuditPayload } from '@/lib/layer2/audit-chain'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const sessionEntityId = (session.user as Record<string, unknown>).entityId as string
  const { entityId } = await params

  if (sessionEntityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)

  const entries = await prisma.auditEntry.findMany({
    where: { entityId },
    orderBy: { createdAt: 'asc' },
  })

  const chainEntries = entries.map((e) => ({
    hash: e.hash,
    previousHash: e.previousHash,
    payload: e.payload as unknown as AuditPayload,
  }))

  const verified = verifyChain(chainEntries)

  return ok({ verified, entryCount: entries.length })
}
