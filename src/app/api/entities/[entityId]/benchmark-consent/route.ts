import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const schema = z.object({ allow: z.boolean() })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const sessionEntityId = (session.user as Record<string, unknown>).entityId as string
  const { entityId } = await params

  if (sessionEntityId !== entityId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  await prisma.entity.update({
    where: { id: entityId },
    data: { allowBenchmarkAggregation: parsed.data.allow },
  })

  return NextResponse.json({ ok: true, allowBenchmarkAggregation: parsed.data.allow })
}
