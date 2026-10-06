import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'
import { sendEnquiryAlert } from '@/lib/marketing/enquiry-alert'

const schema = z.object({
  requestId: z.uuid(),
  orgName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  audience: z.enum(['supplier', 'buyer', 'importer', 'general']),
  plan: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
  website: z.string().max(200).optional(),
})

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.pilotEnquiry, ip)
  if (!allowed)
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 422 })

  // A visually hidden field catches simple form bots without exposing a spam verdict.
  if (parsed.data.website) return NextResponse.json({ ok: true }, { status: 201 })

  const { requestId, orgName, contactName, email, audience, plan, message } = parsed.data
  try {
    await prisma.pilotEnquiry.create({
      data: {
        requestId,
        orgName,
        contactName,
        email: email.toLowerCase(),
        audience,
        plan: plan || null,
        message: message || null,
      },
    })
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: true }, { status: 200 })
    }
    return NextResponse.json(
      { error: 'We could not save your request. Please try again later.' },
      { status: 503 },
    )
  }

  await sendEnquiryAlert({ kind: 'pilot', orgName, detail: [audience, plan].filter(Boolean).join(' · ') })
  return NextResponse.json({ ok: true }, { status: 201 })
}
