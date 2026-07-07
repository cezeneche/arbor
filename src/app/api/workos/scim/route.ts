import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyWorkosSignature } from '@/lib/webhooks/verify-signature'

// SCIM provisioning webhook from WorkOS. Deactivation sets isActive false and bumps
// tokenVersion (revoking live sessions). Activation/creation (re)enables the account
// against the entity bound to the WorkOS organisation.
//
// Authenticity is proven by verifying the WorkOS signature over the raw request
// body against WORKOS_WEBHOOK_SECRET — not by comparing a static bearer token.
const bodySchema = z.object({
  event: z.string(),
  data: z.object({
    email: z.string().email(),
    organizationId: z.string().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
  }),
})

export async function POST(req: NextRequest) {
  const secret = process.env.WORKOS_WEBHOOK_SECRET
  if (!secret) {
    // Missing secret is a deploy error — refuse rather than accept unverified events.
    return NextResponse.json({ error: 'Webhook secret not configured', code: 'MISCONFIGURED' }, { status: 503 })
  }

  // Read the raw body once and verify the signature over those exact bytes before parsing.
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('workos-signature') ?? req.headers.get('x-workos-signature')
  if (!verifyWorkosSignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 })

  const { event, data } = parsed.data
  const email = data.email.toLowerCase()

  if (event === 'user.deactivated' || event === 'dsync.user.deleted') {
    await prisma.user.updateMany({
      where: { email },
      data: { isActive: false, tokenVersion: { increment: 1 } },
    })
    return NextResponse.json({ ok: true, action: 'deactivated' })
  }

  if (event === 'user.activated' || event === 'dsync.user.created') {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { isActive: true } })
      return NextResponse.json({ ok: true, action: 'reactivated' })
    }
    if (data.organizationId) {
      const entity = await prisma.entity.findUnique({ where: { workosOrganisationId: data.organizationId }, select: { id: true } })
      if (entity) {
        const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || email
        await prisma.user.create({ data: { email, name, entityId: entity.id, role: 'CONTRIBUTOR', isActive: true } })
        return NextResponse.json({ ok: true, action: 'provisioned' })
      }
    }
  }

  return NextResponse.json({ ok: true, action: 'ignored' })
}
