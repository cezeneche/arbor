import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { defaultVerificationDeps, submitStatement } from '@/lib/layer2/cbam-verification'

// Add an accredited verifier's statement to a goods line. The file is stored in
// Arbor and Nucleos is told by reference; if Nucleos cannot be reached the
// statement is kept and can be retried. Any user with write access may add one.

const STATUS = { NOT_PDF: 415, TOO_LARGE: 413, INVALID: 400, AWAITING_DECISION: 409 } as const

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

  const result = await submitStatement(
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
    await defaultVerificationDeps(),
  )
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.code] })
  return NextResponse.json(result, { status: 201 })
}
