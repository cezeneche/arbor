import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import {
  createSupplierToken,
  SupplierRequestRejectedError,
} from '@/lib/nucleos/supplier-request-client'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'

// Creates a tokenised supplier form link for a goods line.
//
// Write access, not just a session: this generates a credential that lets
// someone outside the organisation submit data against a goods line. So the
// line has to be the caller's — on a case their organisation owns.

export async function POST(request: Request) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  let body: { case_id?: unknown; goods_line_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Choose a goods line and try again.' }, { status: 400 })
  }

  const entityId = getSessionUser(session).entityId as string
  const access = await resolveGoodsLineAccess(body.case_id, body.goods_line_id, entityId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const goodsLineId = String(body.goods_line_id).trim()
  try {
    return NextResponse.json(await createSupplierToken(goodsLineId))
  } catch (err) {
    // A permanent rejection reported as an outage sends the user round a retry
    // loop that cannot close, and hides the actual fault.
    if (err instanceof SupplierRequestRejectedError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    return NextResponse.json(
      { error: 'The request could not be created. Please try again shortly.' },
      { status: 502 },
    )
  }
}
