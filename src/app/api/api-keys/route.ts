import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { hash } from 'bcryptjs'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({ label: z.string().min(1).max(100) })

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const keys = await prisma.apiKey.findMany({
    where: { entityId, isActive: true },
    select: { id: true, label: true, lastUsed: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const plaintext = `arb_${randomBytes(24).toString('hex')}`
  const keyHash = await hash(plaintext, 12)

  const key = await prisma.apiKey.create({
    data: { entityId, label: parsed.data.label, keyHash },
    select: { id: true, label: true, createdAt: true },
  })

  // Plaintext returned once — never stored, never retrievable again
  return NextResponse.json({ key, plaintext })
}
