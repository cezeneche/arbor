// Layer 2  -  updates entity's allowBenchmarkAggregation flag.
// Logs consent grant/revocation in the audit chain for traceability (PRD §19.3).
// The mutation + audit write live in the shared setBenchmarkConsent helper so this
// route and /api/entities/[entityId]/benchmark-consent stay identical.
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { setBenchmarkConsent } from '@/lib/layer2/benchmark-consent'

export async function POST(req: NextRequest) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const userId = getSessionUser(session).id

  let body: { allow: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.allow !== 'boolean') {
    return NextResponse.json({ error: "'allow' must be boolean" }, { status: 400 })
  }

  await setBenchmarkConsent(entityId, userId, body.allow)

  return NextResponse.json({ allowBenchmarkAggregation: body.allow })
}
