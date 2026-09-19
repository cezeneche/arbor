import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { NucleosUnavailableError, isNucleosConfigured } from '@/lib/nucleos/extraction-client'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'

// Records a carbon price relief claim. This one writes, against a goods line the
// browser names — so the line is checked to be on a case the caller owns first.

export async function POST(request: Request) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Check the figures and try again.' }, { status: 400 })
  }

  const entityId = getSessionUser(session).entityId as string
  const { case_id: caseId, ...claim } = body
  const access = await resolveGoodsLineAccess(caseId, claim.goods_line_id, entityId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    if (!isNucleosConfigured()) throw new NucleosUnavailableError('not configured')
    const res = await fetch(`${process.env.NUCLEOS_URL}/api/cbam/cpr/claims`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.NUCLEOS_INTERNAL_TOKEN as string}`,
      },
      body: JSON.stringify(claim),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 422) {
      return NextResponse.json(
        { error: 'These figures do not make a valid claim.' },
        { status: 422 },
      )
    }
    if (!res.ok) throw new NucleosUnavailableError(`cpr claim failed: ${res.status}`)
    return NextResponse.json(await res.json(), { status: 201 })
  } catch {
    return NextResponse.json(
      { error: 'The claim could not be recorded right now. Please try again shortly.' },
      { status: 502 },
    )
  }
}
