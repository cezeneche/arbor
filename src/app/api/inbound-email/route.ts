import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { inngest } from '@/inngest/client'
import { extractRequestToken } from '@/lib/requests/inbound-parse'

// Gap 8.4 / Core 5 — inbound email webhook. The email provider (Postmark /
// SendGrid) POSTs parsed messages here. We verify a shared secret, derive the
// entity token from the recipient address, and enqueue processing. Two patterns:
//   upload-<token>@arbor.io   → attachments become documents (Gap 8.4)
//   requests-<token>@arbor.io → the email body is parsed as a data request (Core 5)
const attachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  contentBase64: z.string(),
})

const bodySchema = z.object({
  to: z.string(),
  fromEmail: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  attachments: z.array(attachmentSchema).default([]),
})

function extractToken(to: string): string | null {
  // upload-<token>@arbor.io
  const match = to.match(/upload-([a-z0-9]+)@/i)
  return match ? match[1] : null
}

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET
  const provided = req.headers.get('x-inbound-secret')
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 })

  // Always 200 so the provider does not retry; unknown/empty messages are dropped.
  // Core 5 — a requests-<token>@ address routes to the data-request handler.
  const requestToken = extractRequestToken(parsed.data.to)
  if (requestToken) {
    const text = [parsed.data.subject, parsed.data.text].filter(Boolean).join('\n\n')
    if (text.trim().length === 0) return NextResponse.json({ ok: true })
    await inngest.send({
      name: 'request/inbound',
      data: { entityToken: requestToken, fromEmail: parsed.data.fromEmail, text },
    })
    return NextResponse.json({ ok: true })
  }

  const token = extractToken(parsed.data.to)
  if (!token || parsed.data.attachments.length === 0) return NextResponse.json({ ok: true })

  await inngest.send({
    name: 'email/inbound',
    data: { entityToken: token, fromEmail: parsed.data.fromEmail, attachments: parsed.data.attachments },
  })

  return NextResponse.json({ ok: true })
}
