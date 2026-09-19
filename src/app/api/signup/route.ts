import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'
import { createAccount, EmailTakenError } from '@/lib/auth/create-account'

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

  // A fast answer for the common case. The binding check is the unique
  // constraint inside createAccount, which a concurrent signup cannot slip past.
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const passwordHash = await hash(password, 12)

  try {
    await createAccount(prisma, { companyName, sector, country, entityType, name, email, passwordHash })
  } catch (e) {
    if (e instanceof EmailTakenError) {
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json({ ok: true })
}
