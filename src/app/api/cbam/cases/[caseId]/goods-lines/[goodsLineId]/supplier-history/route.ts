import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { getSupplierHistory } from '@/lib/nucleos/supplier-history-client'
import { presentSupplierHistory } from '@/lib/nucleos/supplier-history-presenter'

// A goods line's supplier history: the installation's earlier figures for the
// same goods, and whether this one departs from them. Read-only.

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

  try {
    return NextResponse.json(presentSupplierHistory(await getSupplierHistory(goodsLineId)))
  } catch {
    return NextResponse.json(
      { error: 'The CBAM service could not be reached. Try again in a moment.' },
      { status: 502 },
    )
  }
}
