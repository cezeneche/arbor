import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWorkosSignature } from '@/lib/webhooks/verify-signature'
import { scimWebhookSchema, interpretScimWebhook } from '@/lib/sso/scim-event'

// Directory Sync (SCIM) provisioning webhook from WorkOS. Maps WorkOS directory
// events onto Arbor accounts: create/reactivate sets isActive true against the
// entity bound to the WorkOS organisation; deactivation sets isActive false and
// bumps tokenVersion, revoking the user's live sessions.
//
// Authenticity is proven by verifying the WorkOS signature over the raw request
// body against WORKOS_WEBHOOK_SECRET — not by comparing a static token.

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

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const parsed = scimWebhookSchema.safeParse(json)
  // A signed but unrecognised event (e.g. group sync) is not an error — acknowledge
  // with 200 so WorkOS does not retry it.
  if (!parsed.success) return NextResponse.json({ ok: true, action: 'ignored' })

  const intent = interpretScimWebhook(parsed.data)

  switch (intent.kind) {
    case 'deactivate': {
      await prisma.user.updateMany({
        where: { email: intent.email },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      })
      return NextResponse.json({ ok: true, action: 'deactivated' })
    }

    case 'reactivate': {
      const existing = await prisma.user.findUnique({ where: { email: intent.email }, select: { id: true } })
      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data: { isActive: true } })
        return NextResponse.json({ ok: true, action: 'reactivated' })
      }
      // No local account yet — fall through to provisioning it against the org.
      return provision(intent.email, intent.name, intent.organizationId)
    }

    case 'provision': {
      const existing = await prisma.user.findUnique({ where: { email: intent.email }, select: { id: true } })
      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data: { isActive: intent.active } })
        return NextResponse.json({ ok: true, action: intent.active ? 'reactivated' : 'deactivated' })
      }
      if (!intent.active) return NextResponse.json({ ok: true, action: 'ignored' })
      return provision(intent.email, intent.name, intent.organizationId)
    }

    default:
      return NextResponse.json({ ok: true, action: 'ignored' })
  }
}

// Create a CONTRIBUTOR account bound to the entity for the WorkOS organisation.
// Unknown organisation → acknowledged but not provisioned.
async function provision(email: string, name: string, organizationId: string | null) {
  if (!organizationId) return NextResponse.json({ ok: true, action: 'ignored' })
  const entity = await prisma.entity.findUnique({
    where: { workosOrganisationId: organizationId },
    select: { id: true },
  })
  if (!entity) return NextResponse.json({ ok: true, action: 'ignored' })
  await prisma.user.create({
    data: { email, name, entityId: entity.id, role: 'CONTRIBUTOR', isActive: true },
  })
  return NextResponse.json({ ok: true, action: 'provisioned' })
}
