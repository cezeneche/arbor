import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { defaultVerificationDeps, syncStatement } from '@/lib/layer2/cbam-verification'
import { defaultReliefStatementDeps, syncReliefStatement } from '@/lib/layer2/cbam-relief-statement'

// Add a stored statement to the case, after Nucleos could not be reached when it
// was uploaded. Safe to press twice. A relief statement goes to the relief
// claim; an emissions statement to the line's verification step.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string; statementId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const user = getSessionUser(session)
  const { caseId, goodsLineId, statementId } = await params

  const access = await resolveGoodsLineAccess(caseId, goodsLineId, user.entityId as string)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const row = await prisma.cbamVerificationStatement.findFirst({
    where: { id: statementId, entityId: user.entityId as string, goodsLineId, syncedAt: null },
  })
  if (!row)
    return NextResponse.json({ error: 'There is nothing to retry for this statement.' }, { status: 404 })

  const result =
    row.subject === 'RELIEF'
      ? await syncReliefStatement(row, await defaultReliefStatementDeps())
      : await syncStatement(row, await defaultVerificationDeps())
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })
  return NextResponse.json({ ok: true })
}
