import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess, requireAuth } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { domainSchema } from '@/lib/constants'
import { assembleAuditPackage } from '@/lib/audit-package/assemble'
import { shareState } from '@/lib/shares/share-status'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/tokens/opaque-token'

const bodySchema = z.object({
  domain: domainSchema.optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
})

function shareUrl(req: NextRequest, token: string): string {
  const origin = req.nextUrl.origin
  return `${origin}/share/${token}`
}

// Layer 3 — read-only assembly. Creating a share computes the scope's audit-package
// integrity hash (and logs it, so /api/audit/verify-public recognises it) and mints
// an unguessable public token. No stored data is modified.
export async function POST(req: NextRequest) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const createdById = getSessionUser(session).id

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const periodStart = parsed.data.periodStart ? new Date(parsed.data.periodStart) : null
  const periodEnd = parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null

  // Reuse the Gap-4 audit package to derive a verifiable integrity hash for the
  // scope, and log it so the public verify endpoint will recognise it.
  const { package: pkg } = await assembleAuditPackage({
    entityId,
    periodStart,
    periodEnd,
    logRequestedById: createdById,
  })

  // Raw token is returned once (below); only its hash is stored.
  const token = generateOpaqueToken()

  const share = await prisma.sharedExport.create({
    data: {
      entityId,
      tokenHash: hashOpaqueToken(token),
      domain: parsed.data.domain ?? null,
      periodStart,
      periodEnd,
      packageHash: pkg.packageIntegrityHash,
      createdById,
      expiresAt,
    },
  })

  return ok({ id: share.id, token, url: shareUrl(req, token), packageHash: share.packageHash }, 201)
}

// Lists the caller entity's own shares with their current lifecycle state.
export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const shares = await prisma.sharedExport.findMany({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
  })

  // The raw token is never returned in a list — it exists only at creation time.
  return ok({
    shares: shares.map((s) => ({
      id: s.id,
      domain: s.domain,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      state: shareState(s),
    })),
  })
}
