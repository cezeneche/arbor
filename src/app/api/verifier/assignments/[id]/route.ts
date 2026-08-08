import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireVerifier } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { computeVerificationSignature } from '@/lib/layer2/verification-signature'
import { type AuditPayload } from '@/lib/layer2/audit-chain'
import { appendAuditEntry } from '@/lib/layer2/audit-append'
import { runSerializable } from '@/lib/layer2/serializable'
import { sendNotification } from '@/lib/notifications'

const bodySchema = z.object({
  action: z.enum(['verify', 'reject']),
  note: z.string().max(2000).optional(),
})

// a verifier signs off (or rejects) an assigned entity+period.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireVerifier()
  if (!session) return response!

  const verifierId = getSessionUser(session).id
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)
  const { action, note } = parsed.data

  const assignment = await prisma.verificationAssignment.findUnique({ where: { id } })
  if (!assignment) return err('Assignment not found', 'NOT_FOUND', 404)
  if (assignment.verifierId !== verifierId) return err('Access denied', 'FORBIDDEN', 403)
  if (assignment.status === 'VERIFIED' || assignment.status === 'REJECTED') {
    return err('This assignment has already been completed', 'ALREADY_COMPLETED', 409)
  }

  if (action === 'reject' && (!note || note.trim() === '')) {
    return err('A rejection note is required', 'NOTE_REQUIRED', 400)
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // Serializable, not the default: previousHash is read and the next link written
  // in one unit, so a concurrent write cannot fork the entity's chain.
  const result = await runSerializable(async (tx) => {
    let signatureHash: string | null = null
    let eventType: string
    if (action === 'verify') {
      signatureHash = computeVerificationSignature({
        entityId: assignment.entityId,
        periodStart: assignment.periodStart.toISOString(),
        periodEnd: assignment.periodEnd.toISOString(),
        verifierId,
        verifiedAt: nowIso,
      })
      eventType = 'VERIFIED_BY_THIRD_PARTY'
    } else {
      eventType = 'VERIFICATION_REJECTED'
    }

    // Synthetic audit payload — not a DataRecord, so recordId is namespaced.
    const payload: AuditPayload = {
      recordId: `verification_${assignment.id}`,
      entityId: assignment.entityId,
      domain: 'COMPLIANCE',
      fieldName: eventType,
      value: action === 'verify' ? 1 : 0,
      unit: 'verification',
      originalValue: action === 'verify' ? 1 : 0,
      originalUnit: 'verification',
      periodStart: assignment.periodStart.toISOString(),
      periodEnd: assignment.periodEnd.toISOString(),
      trustTier: 'A',
      confidenceScore: 1.0,
      sourceText: note ?? null,
      documentId: null,
      extractionMethod: 'MANUAL_ENTRY',
      submittedAt: nowIso,
      submittedById: verifierId,
    }
    const { hash } = await appendAuditEntry(tx, {
      entityId: assignment.entityId,
      recordId: payload.recordId,
      eventType,
      payload,
    })

    const updated = await tx.verificationAssignment.update({
      where: { id: assignment.id },
      data: {
        status: action === 'verify' ? 'VERIFIED' : 'REJECTED',
        verifiedAt: now,
        verifierNote: note ?? null,
        signatureHash,
      },
    })
    return { updated, signatureHash }
  })

  // Notify the entity (post-commit; non-fatal).
  if (action === 'verify') {
    await sendNotification({
      entityId: assignment.entityId,
      type: 'TIER_UPGRADED',
      payload: { recordId: `verification_${assignment.id}`, domain: 'COMPLIANCE' },
    }).catch((e) => console.error('[verifier] notify failed:', e))
  }

  return ok({
    status: result.updated.status,
    signatureHash: result.signatureHash,
    verifiedAt: result.updated.verifiedAt?.toISOString() ?? null,
  })
}
