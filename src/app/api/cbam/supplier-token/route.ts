import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import {
  createSupplierToken,
  SupplierRequestRejectedError,
} from '@/lib/nucleos/supplier-request-client'

// Creates a tokenised supplier form link for a goods line.
//
// Write access, not just a session: this generates a credential that lets
// someone outside the organisation submit data against a goods line.

export async function POST(request: Request) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  let body: { goods_line_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Choose a goods line and try again.' }, { status: 400 })
  }

  const goodsLineId = String(body.goods_line_id ?? '').trim()
  if (!goodsLineId) {
    return NextResponse.json({ error: 'Choose a goods line and try again.' }, { status: 400 })
  }

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
