// Layer 2 — write path for institutional partner expressions of interest.
// Public endpoint (no auth). Validated and IP-rate-limited to resist spam, since
// it writes rows to InstitutionalEnquiry.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'

const schema = z.object({
  orgName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  role: z.string().trim().max(120).optional(),
  interestArea: z.enum(['BENCHMARKS', 'DATA_PARTNERSHIP', 'POLICY', 'OTHER']),
  message: z.string().trim().max(4000).optional(),
})

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.institutionalEnquiry, ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 422 })
  }

  const { orgName, contactName, email, role, interestArea, message } = parsed.data

  await prisma.institutionalEnquiry.create({
    data: {
      orgName,
      contactName,
      email: email.toLowerCase(),
      role: role || null,
      interestArea,
      message: message || null,
    },
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
