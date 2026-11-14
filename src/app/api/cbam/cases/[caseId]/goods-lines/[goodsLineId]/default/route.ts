import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveGoodsLineAccess } from '@/lib/nucleos/goods-line-access'
import {
  applyPublishedDefault,
  DefaultAlreadyRecordedError,
  NoPublishedDefaultError,
} from '@/lib/nucleos/apply-default-client'

// Records the published default as a goods line's emissions figure, when a
// supplier has not given one. Write access: the figure goes into the return.

function hasAnyFigure(line: Record<string, unknown>): boolean {
  const present = (v: unknown) => v !== null && v !== undefined && v !== ''
  return present(line.direct_kgco2e) || present(line.indirect_kgco2e) || present(line.method)
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; goodsLineId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const { caseId, goodsLineId } = await params
  const entityId = getSessionUser(session).entityId as string
  const access = await resolveGoodsLineAccess(caseId, goodsLineId, entityId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Never replaces a supplier's figure, or completes a partial one.
  if (hasAnyFigure(access.line)) {
    return NextResponse.json({ error: 'This goods line already has an emissions figure.' }, { status: 409 })
  }

  const route = typeof access.line.production_route === 'string' ? access.line.production_route : null
  try {
    await applyPublishedDefault(goodsLineId.trim(), route)
    return NextResponse.json({ recorded: true })
  } catch (err) {
    if (err instanceof DefaultAlreadyRecordedError) {
      return NextResponse.json({ error: 'This goods line already has an emissions figure.' }, { status: 409 })
    }
    if (err instanceof NoPublishedDefaultError) {
      return NextResponse.json(
        { error: 'There is no published default for these goods. Ask the supplier for a figure.' },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: 'The default could not be recorded. Please try again shortly.' },
      { status: 502 },
    )
  }
}
