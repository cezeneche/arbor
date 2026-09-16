import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { isCbamJurisdiction } from '@/lib/nucleos/jurisdiction'

// Which CBAM regime the entity files under.
//
// Admin-only, because it changes what every subsequent document is extracted
// under and which return the product can produce. Records already written are
// untouched — this is not retroactive, and nothing here rewrites a stored
// figure.

const schema = z.object({
  jurisdiction: z.string().refine(isCbamJurisdiction, {
    message: 'Jurisdiction must be UK, EU or BOTH',
  }),
})

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  await prisma.entity.update({
    where: { id: entityId },
    data: { cbamJurisdiction: parsed.data.jurisdiction },
  })

  return NextResponse.json({ ok: true, jurisdiction: parsed.data.jurisdiction })
}
