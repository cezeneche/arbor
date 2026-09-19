import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { consumeEmailVerification } from '@/lib/auth/email-verification'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'

// Public: the token is the credential, as for password reset.
const bodySchema = z.object({ token: z.string().min(1).max(200) })

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.resetPassword, ip)
  if (!allowed) return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'This link could not be used.' }, { status: 400 })

  const outcome = await consumeEmailVerification(prisma, parsed.data.token)
  if (outcome === 'verified') return NextResponse.json({ ok: true })
  return NextResponse.json(
    {
      error:
        outcome === 'expired'
          ? 'This link has expired. Sign in and send a new one from the reminder.'
          : 'This link has already been used or is not valid. Sign in to send a new one.',
    },
    { status: 400 },
  )
}
