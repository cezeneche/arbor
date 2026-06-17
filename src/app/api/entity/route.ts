import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

const schema = z.object({
  legalName: z.string().min(1).max(200).trim(),
  registrationNumber: z.string().max(50).trim().optional(),
  country: z.string().length(2).toUpperCase(),
  sector: z.string().min(1).max(100).trim(),
})

export async function PATCH(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  await prisma.entity.update({
    where: { id: entityId },
    data: {
      legalName: parsed.data.legalName,
      registrationNumber: parsed.data.registrationNumber ?? null,
      country: parsed.data.country,
      sector: parsed.data.sector,
    },
  })

  return NextResponse.json({ ok: true })
}
