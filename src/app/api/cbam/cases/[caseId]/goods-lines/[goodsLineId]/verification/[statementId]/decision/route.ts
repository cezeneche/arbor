import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { decideStatement, defaultVerificationDeps } from '@/lib/layer2/cbam-verification'

// Accept or reject a verifier's statement. Accepting lets the supplier's figure
// go on the return as actual, verified data; rejecting needs a reason, which is
// kept with the statement. Any user with write access may decide.

const body = z.object({
  decision: z.enum(['accept', 'reject']),
  reason: z.string().max(1000).optional(),
})

const STATUS = { NOT_FOUND: 404, INVALID: 400, REFUSED: 409, UNAVAILABLE: 502 } as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string; statementId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const user = getSessionUser(session)
  const { caseId, goodsLineId, statementId } = await params

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose accept or reject.' }, { status: 400 })

  const access = await resolveGoodsLineAccess(caseId, goodsLineId, user.entityId as string)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const result = await decideStatement(
    {
      entityId: user.entityId as string,
      userId: user.id as string,
      goodsLineId,
      statementId,
      decision: parsed.data.decision,
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
    },
    await defaultVerificationDeps(),
  )
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.code] })
  return NextResponse.json({ ok: true })
}
