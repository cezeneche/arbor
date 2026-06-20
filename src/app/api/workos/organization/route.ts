import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const schema = z.object({ workosOrganisationId: z.string().trim().min(1).nullable() })

// Gap 10.5 — bind (or clear) the caller's entity to a WorkOS organisation.
export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)
  const orgId = parsed.data.workosOrganisationId

  // Enforce uniqueness: an org can bind to only one entity.
  if (orgId) {
    const clash = await prisma.entity.findUnique({ where: { workosOrganisationId: orgId }, select: { id: true } })
    if (clash && clash.id !== entityId) {
      return err('That WorkOS organisation is already linked to another account', 'ORG_IN_USE', 409)
    }
  }

  await prisma.entity.update({ where: { id: entityId }, data: { workosOrganisationId: orgId } })
  return ok({ ok: true, workosOrganisationId: orgId })
}
