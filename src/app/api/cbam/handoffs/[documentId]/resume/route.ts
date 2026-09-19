import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { runCbamHandoff } from '@/lib/layer2/cbam-handoff'

// Resume opening the CBAM case for a confirmed document.
//
// The way back from a handoff that failed or stopped halfway. Safe to press
// twice: a finished handoff is left alone, one already running is left to
// finish, and nothing that already landed in Nucleos is posted again.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { documentId } = await params

  const link = await prisma.cbamCaseLink.findFirst({
    where: { documentId, entityId },
    select: { documentId: true },
  })
  if (!link) {
    return NextResponse.json(
      { error: 'There is no case to resume for this document.', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  const outcome = await runCbamHandoff(documentId)
  return NextResponse.json({
    caseId: outcome.caseId,
    status: outcome.status,
    problems: outcome.problems,
  })
}
