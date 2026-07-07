import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateWebhookSecret } from '@/lib/webhooks/signing'
import { encryptSecret } from '@/lib/crypto/credential-encryption'
import type { Prisma } from '@prisma/client'

const EVENT_VALUES = ['RECORD_CERTIFIED', 'RECORD_SUPERSEDED', 'ACCESS_GRANTED', 'ACCESS_REVOKED'] as const

const createSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'URL must use HTTPS'),
  events: z.array(z.enum(EVENT_VALUES)).min(1),
})

export async function GET() {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const subs = await prisma.webhookSubscription.findMany({
    where: { entityId },
    select: {
      id: true,
      url: true,
      events: true,
      secretPrefix: true,
      isActive: true,
      createdAt: true,
      lastDeliveryAt: true,
      lastDeliveryStatus: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return ok({ subscriptions: subs })
}

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  // Generate the signing secret; show it once, store only the encrypted form.
  const secret = generateWebhookSecret()
  const sub = await prisma.webhookSubscription.create({
    data: {
      entityId,
      url: parsed.data.url,
      events: parsed.data.events as unknown as Prisma.InputJsonValue,
      secretEncrypted: encryptSecret(secret),
      secretPrefix: secret.slice(0, 14),
    },
    select: { id: true },
  })

  return ok({ id: sub.id, signingSecret: secret, note: 'This secret will not be shown again.' }, 201)
}
