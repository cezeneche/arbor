import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAuth, requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import { computeRecordHash, type AuditPayload } from '@/lib/layer2/audit-chain'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import type { Prisma } from '@prisma/client'

const createSchema = z.object({
  granteeEntityId: z.string().min(1),
  domain: z.string().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  // Gap 5.4 — the supplier must acknowledge the data-use consent statement.
  consent: z.literal(true),
})

export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const grants = await prisma.dataAccessGrant.findMany({
    where: {
      OR: [{ grantorEntityId: entityId }, { granteeEntityId: entityId }],
      isActive: true,
    },
    include: {
      grantorEntity: { select: { legalName: true } },
      granteeEntity: { select: { legalName: true } },
    },
    orderBy: { grantedAt: 'desc' },
  })

  return NextResponse.json({ grants })
}

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const { granteeEntityId, domain, periodStart, periodEnd } = parsed.data

  const grantee = await prisma.entity.findUnique({ where: { id: granteeEntityId }, select: { legalName: true } })
  if (!grantee) return NextResponse.json({ error: 'Grantee entity not found.' }, { status: 404 })

  const grant = await prisma.dataAccessGrant.create({
    data: {
      grantorEntityId: entityId,
      granteeEntityId,
      domain: domain as never ?? null,
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
    },
  })

  // Gap 5.4 — record the consent acknowledgement in the audit chain. recordId is
  // namespaced 'consent_' so the chain-verify route treats it as a synthetic entry.
  try {
    const nowIso = new Date().toISOString()
    const lastEntry = await prisma.auditEntry.findFirst({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    })
    const previousHash = lastEntry?.hash ?? null
    const payload: AuditPayload = {
      recordId: `consent_${grant.id}`,
      entityId,
      domain: (domain as string) ?? 'COMPLIANCE',
      fieldName: 'access_granted_with_consent',
      value: 1,
      unit: 'grant',
      originalValue: 1,
      originalUnit: 'grant',
      periodStart: periodStart ?? nowIso,
      periodEnd: periodEnd ?? nowIso,
      trustTier: 'A',
      confidenceScore: 1.0,
      sourceText: `Supplier acknowledged data-use consent when granting access to ${grantee.legalName}.`,
      documentId: null,
      extractionMethod: 'MANUAL_ENTRY',
      submittedAt: nowIso,
      submittedById: getSessionUser(session).id,
    }
    const hash = computeRecordHash(payload, previousHash)
    await prisma.auditEntry.create({
      data: {
        entityId,
        recordId: payload.recordId,
        eventType: 'ACCESS_GRANTED_WITH_CONSENT',
        payload: payload as unknown as Prisma.InputJsonValue,
        hash,
        previousHash,
      },
    })
  } catch (e) {
    console.error('[grants] consent audit entry failed:', e)
  }

  await sendNotification({
    entityId: granteeEntityId,
    type: 'ACCESS_GRANTED',
    payload: { grantId: grant.id, grantorEntityId: entityId },
  }).catch(e => console.error('[grants] sendNotification failed:', e))

  // Gap 6 — webhook to the buyer that access was granted.
  await dispatchWebhook(granteeEntityId, 'access.granted', {
    grantId: grant.id,
    grantorEntityId: entityId,
    domain: domain ?? null,
  })

  return NextResponse.json({ grant })
}
