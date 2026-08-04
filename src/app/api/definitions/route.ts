// Layer 3 — read-only. The governed data dictionary as this entity sees it.
//
// Publishing a new version is deliberately not here: a definition is shared
// vocabulary, so one tenant editing it would silently change what everyone
// else's numbers mean. That is a platform-operator action (/api/admin/definitions).
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { loadDefinitionsOverview } from '@/lib/layer3/definitions-overview'

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const asOfParam = req.nextUrl.searchParams.get('asOf')
  const asOf = asOfParam && !isNaN(Date.parse(asOfParam)) ? new Date(asOfParam) : new Date()

  return NextResponse.json(await loadDefinitionsOverview(entityId, asOf))
}
