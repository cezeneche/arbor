import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { hash } from 'bcryptjs'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/auth-helpers'
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
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const prefix = randomBytes(4).toString('hex')       // 8 hex chars  -  stored for O(1) lookup
  const secret = randomBytes(24).toString('hex')       // 48 hex chars  -  never stored
  const plaintext = `arb_${prefix}_${secret}`
  const keyHash = await hash(plaintext, 12)

  const key = await prisma.apiKey.create({
    data: { entityId, label: parsed.data.label, keyPrefix: prefix, keyHash },
    select: { id: true, label: true, createdAt: true },
  })

  // Plaintext returned once  -  never stored, never retrievable again
  return NextResponse.json({ key, plaintext })
}
