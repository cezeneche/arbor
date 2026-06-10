import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const schema = z.object({
  legalName: z.string().min(1).max(200).trim(),
  registrationNumber: z.string().max(50).trim().optional(),
  country: z.string().length(2).toUpperCase(),
  sector: z.string().min(1).max(100).trim(),
})

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const role = (session.user as Record<string, unknown>).role as string
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only administrators can update organisation details' }, { status: 403 })
  }

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
