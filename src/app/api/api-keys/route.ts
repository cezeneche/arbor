import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { hash } from 'bcryptjs'
import { requireAuth, requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({
  label: z.string().min(1).max(100),
  scope: z.enum(['READ', 'READ_WRITE']).default('READ_WRITE'),
  // Optional lifetime; omitted = never expires.
  expiresInDays: z.number().int().positive().max(3650).optional(),
  // Optional source-IP allowlist (exact match). Omitted/empty = any IP.
  ipAllowlist: z.array(z.string().trim().min(1).max(45)).max(50).optional(),
})

export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

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
  const entityId = getSessionUser(session).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const prefix = randomBytes(4).toString('hex')       // 8 hex chars  -  stored for O(1) lookup
  const secret = randomBytes(24).toString('hex')       // 48 hex chars  -  never stored
  const plaintext = `arb_${prefix}_${secret}`
  const keyHash = await hash(plaintext, 12)

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  const key = await prisma.apiKey.create({
    data: {
      entityId,
      label: parsed.data.label,
      keyPrefix: prefix,
      keyHash,
      scope: parsed.data.scope,
      expiresAt,
      ipAllowlist: parsed.data.ipAllowlist ?? [],
    },
    select: { id: true, label: true, createdAt: true, scope: true, expiresAt: true },
  })

  // Plaintext returned once  -  never stored, never retrievable again
  return NextResponse.json({ key, plaintext })
}
