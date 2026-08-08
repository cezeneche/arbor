// Answer a proposed definition. Only the counterparty may answer — the
// permission rule lives in the pure canRespondToProposal so the API and the UI
// cannot drift apart on who is allowed to do what.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { canRespondToProposal, type StoredAgreement } from '@/lib/definitions/agreement'
import { sendNotification } from '@/lib/notifications'

const respondSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  note: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Answering a proposal is ADMIN-only for the same reason as making one — accepting
// commits the organisation to that wording.
  const { session, response } = await requireAdmin()
  if (!session) return response!
  const user = getSessionUser(session)
  const entityId = user.entityId as string
  const { id } = await ctx.params

  const body = await req.json().catch(() => null)
  const parsed = respondSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { decision, note } = parsed.data

  const row = await prisma.definitionAgreement.findUnique({
    where: { id },
    select: {
      id: true,
      fieldDefinitionId: true,
      definitionVersion: true,
      supplierEntityId: true,
      buyerEntityId: true,
      status: true,
      proposedByEntityId: true,
      respondedAt: true,
      fieldDefinition: { select: { label: true, domain: true, fieldName: true } },
    },
  })
  if (!row) {
    return NextResponse.json({ error: 'That proposal does not exist.' }, { status: 404 })
  }

  const agreement: StoredAgreement = {
    id: row.id,
    fieldDefinitionId: row.fieldDefinitionId,
    definitionVersion: row.definitionVersion,
    fieldName: row.fieldDefinition.fieldName,
    domain: row.fieldDefinition.domain as string,
    supplierEntityId: row.supplierEntityId,
    buyerEntityId: row.buyerEntityId,
    status: row.status as StoredAgreement['status'],
    proposedByEntityId: row.proposedByEntityId,
    respondedAt: row.respondedAt,
  }

  const permission = canRespondToProposal(agreement, entityId)
  if (!permission.allowed) {
    // 404 for a stranger — no reason to confirm the proposal exists to someone
    // who is not a party to it.
    const isParty = entityId === row.supplierEntityId || entityId === row.buyerEntityId
    return NextResponse.json(
      { error: isParty ? permission.reason : 'That proposal does not exist.' },
      { status: isParty ? 409 : 404 },
    )
  }

  // Conditional on the proposal still being PROPOSED. Read-then-write meant two
  // responses in flight could both pass canRespondToProposal and the later one
  // silently overwrote the earlier — "agreed" is a fact about two organisations,
  // so it must not be decided by whichever request happened to finish last.
  const answered = await prisma.definitionAgreement.updateMany({
    where: { id, status: 'PROPOSED' },
    data: {
      status: decision === 'accept' ? 'ACCEPTED' : 'REJECTED',
      respondedById: user.id as string,
      respondedAt: new Date(),
      ...(note ? { note } : {}),
    },
  })
  if (answered.count === 0) {
    return NextResponse.json({ error: 'This wording has already been answered.' }, { status: 409 })
  }

  if (decision === 'accept') {
    const responder = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { legalName: true },
    })
    await sendNotification({
      entityId: row.proposedByEntityId,
      type: 'DEFINITION_AGREED',
      payload: {
        fieldDefinitionId: row.fieldDefinitionId,
        fieldLabel: row.fieldDefinition.label,
        domain: row.fieldDefinition.domain,
        agreedByName: responder?.legalName ?? 'The other company',
      },
    })
  }

  return NextResponse.json({ status: decision === 'accept' ? 'ACCEPTED' : 'REJECTED' })
}
