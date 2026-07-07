import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { encryptSecret } from '@/lib/crypto/credential-encryption'
import type { IntegrationProvider } from '@prisma/client'

const PROVIDERS = ['CDS', 'SAP', 'NETSUITE', 'ORACLE'] as const

// Credentials are an opaque key→value blob, encrypted before storage.
const bodySchema = z.object({ credentials: z.record(z.string(), z.string()).refine((c) => Object.keys(c).length > 0) })

function parseProvider(raw: string): IntegrationProvider | null {
  const upper = raw.toUpperCase()
  return (PROVIDERS as readonly string[]).includes(upper) ? (upper as IntegrationProvider) : null
}

// connect (store encrypted credentials).
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string
  const provider = parseProvider((await params).provider)
  if (!provider) return err('Unknown provider', 'NOT_FOUND', 404)

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid credentials payload', 'VALIDATION_ERROR', 400)

  const encryptedCredentials = encryptSecret(JSON.stringify(parsed.data.credentials))
  await prisma.integrationCredential.upsert({
    where: { entityId_provider: { entityId, provider } },
    create: { entityId, provider, encryptedCredentials, isActive: true },
    update: { encryptedCredentials, isActive: true },
  })

  return ok({ ok: true, provider }, 201)
}

// disconnect (delete credentials).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string
  const provider = parseProvider((await params).provider)
  if (!provider) return err('Unknown provider', 'NOT_FOUND', 404)

  await prisma.integrationCredential.deleteMany({ where: { entityId, provider } })
  return ok({ ok: true })
}
