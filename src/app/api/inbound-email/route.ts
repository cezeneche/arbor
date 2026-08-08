import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import { inngest } from '@/inngest/client'
import { extractRequestToken } from '@/lib/requests/inbound-parse'
import { verifyTimestampedBodyHmac } from '@/lib/webhooks/verify-signature'
import { claimOnce } from '@/lib/rate-limit'

// Inbound email webhook. The email provider (Postmark / SendGrid) POSTs parsed
// messages here. We verify a signed, timestamped payload, derive the entity token
// from the recipient address, and enqueue processing. Two patterns:
//   upload-<token>@arbor.io   → attachments become documents
//   requests-<token>@arbor.io → the email body is parsed as a data request
//
// The provider must send BOTH headers:
//   x-inbound-timestamp: unix seconds
//   x-inbound-signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
// The previous scheme signed the body alone, so one captured delivery could be
// replayed for ever. The timestamp is inside the signed material, so it cannot be
// moved to widen the window, and claimOnce stops a second delivery of the same
// body inside it.

// A single email cannot be allowed to define how much work Arbor does. Base64
// inflates by ~4/3, so these are limits on what arrives, not on decoded bytes.
const MAX_BODY_BYTES = 30_000_000
const MAX_ATTACHMENTS = 20
const MAX_ATTACHMENT_BASE64 = 15_000_000
const REPLAY_WINDOW_SECONDS = 600

const attachmentSchema = z.object({
  name: z.string().min(1).max(500),
  contentType: z.string().min(1).max(200),
  contentBase64: z.string().max(MAX_ATTACHMENT_BASE64),
})

const bodySchema = z.object({
  to: z.string().min(1).max(1000),
  // Validated as an address: it is carried into the request pipeline and shown to
  // users, so an arbitrary string had no business being treated as a sender.
  fromEmail: z.string().email().max(320).optional(),
  subject: z.string().max(2000).optional(),
  text: z.string().max(1_000_000).optional(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]),
})

function extractToken(to: string): string | null {
  // upload-<token>@arbor.io
  const match = to.match(/upload-([a-z0-9]+)@/i)
  return match ? match[1] : null
}

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured', code: 'MISCONFIGURED' }, { status: 503 })
  }

  // Refuse an oversized body before reading it, where the provider tells us how
  // big it is; the read below is still bounded by the same limit.
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large', code: 'TOO_LARGE' }, { status: 413 })
  }

  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large', code: 'TOO_LARGE' }, { status: 413 })
  }

  const verified = verifyTimestampedBodyHmac(
    rawBody,
    req.headers.get('x-inbound-timestamp'),
    req.headers.get('x-inbound-signature'),
    secret,
    { toleranceSec: REPLAY_WINDOW_SECONDS },
  )
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  // Even a correctly signed delivery is accepted once. The body hash is the
  // identity: two identical signed payloads are the same delivery.
  const fresh = await claimOnce(
    `inbound-email:${createHash('sha256').update(rawBody).digest('hex')}`,
    REPLAY_WINDOW_SECONDS * 2,
  )
  if (!fresh) {
    // 200 so the provider stops retrying — the message was already accepted.
    return NextResponse.json({ ok: true, duplicate: true })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 })

  // Always 200 so the provider does not retry; unknown/empty messages are dropped.
  // a requests-<token>@ address routes to the data-request handler.
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
