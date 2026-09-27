import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

// Whether the CBAM section appears in the organisation's navigation. Admin-only,
// like the regime it sits beside in Settings. It changes nothing but the
// navigation: an organisation with CBAM activity sees the section regardless.

const schema = z.object({ enabled: z.boolean() })

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "'enabled' must be true or false" }, { status: 400 })

  await prisma.entity.update({
    where: { id: getSessionUser(session).entityId as string },
    data: { cbamEnabled: parsed.data.enabled },
  })
  return NextResponse.json({ ok: true, enabled: parsed.data.enabled })
}
