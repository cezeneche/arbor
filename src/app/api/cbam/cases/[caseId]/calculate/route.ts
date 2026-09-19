import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { calculateCase } from '@/lib/nucleos/case-calculation'

// What a case's goods lines actually declare.
//
// A read: the engine is pure and writes nothing, and neither does this. It
// exists alongside the server-rendered emissions section so the figures can be
// re-asked for without a page load once a supplier answers.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { caseId } = await params

  const result = await calculateCase(caseId, entityId)

  if (result.forbidden) {
    return NextResponse.json(
      { error: 'This case could not be found.', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }
  if (result.loadError) {
    return NextResponse.json(
      { error: `This case could not be read: ${result.loadError}`, code: 'NUCLEOS_UNAVAILABLE' },
      { status: 502 },
    )
  }

  return NextResponse.json({ caseId: result.caseId, results: result.results })
}
