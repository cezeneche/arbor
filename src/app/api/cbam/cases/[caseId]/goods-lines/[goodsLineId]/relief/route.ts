import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { listQualifyingSchemes, listReliefClaims } from '@/lib/nucleos/relief-client'
import { presentReliefClaims, reliefNextStep, schemeChoice } from '@/lib/nucleos/relief-presenter'

// Carbon price relief on one goods line: the schemes recognised for its origin,
// its claims (only the newest counts), and the verifier's statement behind each.
// Read-only.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string
  const { caseId, goodsLineId } = await params

  const access = await resolveGoodsLineAccess(caseId, goodsLineId, entityId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const rawOrigin = access.line.origin_country
  const origin = typeof rawOrigin === 'string' && rawOrigin.trim() ? rawOrigin.trim().toUpperCase() : null

  try {
    const [schemes, claims, statements] = await Promise.all([
      origin ? listQualifyingSchemes(origin) : Promise.resolve(null),
      listReliefClaims(goodsLineId),
      prisma.cbamVerificationStatement.findMany({
        where: { entityId, goodsLineId, subject: 'RELIEF' },
        orderBy: { uploadedAt: 'desc' },
        select: { id: true, sha256: true, verifierName: true, verifierAccreditation: true, syncedAt: true, syncError: true },
      }),
    ])
    const rows = presentReliefClaims(claims, statements)
    const next = reliefNextStep(rows)
    // A statement stored while Nucleos was down, for a claim still waiting on
    // one: retrying it is the step, not uploading the same file again.
    const unsynced = next === 'statement' ? statements.find(s => s.syncedAt === null) : undefined

    return NextResponse.json({
      origin,
      schemes: schemeChoice(origin, schemes),
      claims: rows,
      next: unsynced ? 'retry' : next,
      retryStatementId: unsynced?.id ?? null,
      retryProblem: unsynced?.syncError ?? null,
    })
  } catch {
    return NextResponse.json(
      { error: 'The CBAM service could not be reached. Try again in a moment.' },
      { status: 502 },
    )
  }
}
