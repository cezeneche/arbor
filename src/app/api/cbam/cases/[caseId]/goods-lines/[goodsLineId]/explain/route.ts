import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { explainGoodsLineField } from '@/lib/nucleos/explain-client'
import { presentExplanation } from '@/lib/nucleos/explain-presenter'

// "Why this number?" for one goods-line figure: the words on the document it
// was read from. Read-only.

const FIELDS = new Set([
  'net_mass_kg',
  'direct_embedded_kgco2e',
  'indirect_embedded_kgco2e',
  'cn_code',
  'origin_country',
  'installation_id',
])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const user = getSessionUser(session)
  const { caseId, goodsLineId } = await params

  const field = new URL(request.url).searchParams.get('field') ?? ''
  if (!FIELDS.has(field)) {
    return NextResponse.json({ error: 'That figure cannot be explained here.' }, { status: 400 })
  }

  const access = await resolveGoodsLineAccess(caseId, goodsLineId, user.entityId as string)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    return NextResponse.json(presentExplanation(await explainGoodsLineField(caseId, goodsLineId, field)))
  } catch {
    return NextResponse.json(
      { error: 'The CBAM service could not be reached. Try again in a moment.' },
      { status: 502 },
    )
  }
}
