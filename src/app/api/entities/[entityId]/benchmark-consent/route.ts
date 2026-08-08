import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { setBenchmarkConsent } from '@/lib/layer2/benchmark-consent'

const schema = z.object({ allow: z.boolean() })

// Changing consent is a write that must be audit-logged. Gate on write access
// (a read-only VIEWER cannot flip it) and record the change via the shared Layer 2
// helper so this route matches /api/settings/benchmark-consent exactly.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  // ADMIN-only for the same reason as the settings route: consent to aggregation
// binds the whole entity.
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const sessionUser = getSessionUser(session)
  const sessionEntityId = sessionUser.entityId as string
  const { entityId } = await params

  if (sessionEntityId !== entityId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  await setBenchmarkConsent(entityId, sessionUser.id, parsed.data.allow)

  return NextResponse.json({ ok: true, allowBenchmarkAggregation: parsed.data.allow })
}
