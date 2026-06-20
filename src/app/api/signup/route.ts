import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hash } from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'

const signupSchema = z.object({
  companyName: z.string().min(1).max(200),
  sector: z.string().min(1),
  country: z.string().min(2).max(2),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  entityType: z.enum(['SUPPLIER', 'BUYER']).default('SUPPLIER'),
})

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.signup, ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = signupSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { companyName, sector, country, name, password, entityType } = parsed.data
  // Normalise email casing so it matches login and password-reset lookups.
  const email = parsed.data.email.toLowerCase()

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const passwordHash = await hash(password, 12)

  const entity = await prisma.entity.create({
    data: {
      legalName: companyName,
      sector,
      country,
      entityType,
      // Gap 8.4 — email-to-upload token: upload-<token>@arbor.io
      uploadEmailToken: randomBytes(8).toString('hex'),
    },
  })

  await prisma.user.create({
    data: { email, name, passwordHash, entityId: entity.id, role: 'ADMIN' },
  })

  return NextResponse.json({ ok: true })
}
