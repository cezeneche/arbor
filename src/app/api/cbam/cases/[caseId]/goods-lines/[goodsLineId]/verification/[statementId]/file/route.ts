import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import { fetchDocumentBytes } from '@/lib/storage-retrieval'

// The verifier's statement itself, for the organisation that owns it. Served
// through Arbor rather than a public link, so the ownership check always runs.

const NOT_FOUND = { error: 'This statement could not be found.' }

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string; statementId: string }> },
) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string
  const { caseId, goodsLineId, statementId } = await params

  const access = await resolveGoodsLineAccess(caseId, goodsLineId, entityId)
  if (!access.ok) return NextResponse.json(NOT_FOUND, { status: 404 })

  const row = await prisma.cbamVerificationStatement.findFirst({
    where: { id: statementId, entityId, goodsLineId },
    select: { storagePath: true, fileName: true },
  })
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 })

  const bytes = await fetchDocumentBytes(row.storagePath)
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${row.fileName.replace(/[^\w.\- ]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
  })
}
