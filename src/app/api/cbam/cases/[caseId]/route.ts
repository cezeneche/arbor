import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { getCbamCase } from '@/lib/nucleos/cases-client'
import { resolveCaseAccess } from '@/lib/nucleos/case-ownership'

// Not found, not forbidden, for a case that is someone else's: whether a case id
// exists in another organisation is itself not this caller's to learn.
const NOT_FOUND = { error: 'This case could not be found.', code: 'NOT_FOUND' }

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { caseId } = await params

  const access = await resolveCaseAccess(caseId, entityId)
  if (!access.allowed) return NextResponse.json(NOT_FOUND, { status: 404 })

  try {
    return NextResponse.json(await getCbamCase(caseId))
  } catch {
    return NextResponse.json({ error: 'This case could not be loaded.' }, { status: 502 })
  }
}
