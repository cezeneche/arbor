import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { defaultReliefStatementDeps, submitReliefStatement } from '@/lib/layer2/cbam-relief-statement'

// Add the verifier's statement behind a goods line's relief claim. Stored in
// Arbor; Nucleos records it by reference on the claim that counts. Any user
// with write access may add one.

const STATUS = { NOT_PDF: 415, TOO_LARGE: 413, INVALID: 400, REFUSED: 409, UNAVAILABLE: 502 } as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const user = getSessionUser(session)
  const { caseId, goodsLineId } = await params

  const access = await resolveGoodsLineAccess(caseId, goodsLineId, user.entityId as string)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the verifier’s statement as a PDF.' }, { status: 400 })
  }

  const result = await submitReliefStatement(
    {
      entityId: user.entityId as string,
      userId: user.id as string,
      caseId,
      goodsLineId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      verifierName: String(form?.get('verifierName') ?? ''),
      verifierAccreditation: String(form?.get('verifierAccreditation') ?? ''),
    },
    await defaultReliefStatementDeps(),
  )
  if (!result.ok)
    return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.code] })
  return NextResponse.json(result, { status: 201 })
}
