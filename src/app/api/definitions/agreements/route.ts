// Propose that a counterparty agree a field's wording.
//
// Either side may open the conversation — a buyer asking a supplier to confirm
// what they count, or a supplier telling a buyer up front. The other side must
// answer (POST .../[id]/respond); nobody can agree with themselves.
//
// Gated on an existing data-sharing relationship: agreeing definitions with a
// company you neither supply nor buy from is not a real governance act, and
// leaving it open would let any tenant enumerate others by proposing at them.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

const proposeSchema = z.object({
  fieldDefinitionId: z.string().min(1),
  counterpartyEntityId: z.string().min(1),
  note: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const user = getSessionUser(session)
  const entityId = user.entityId as string

  const body = await req.json().catch(() => null)
  const parsed = proposeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { fieldDefinitionId, counterpartyEntityId, note } = parsed.data

  if (counterpartyEntityId === entityId) {
    return NextResponse.json(
      { error: 'A definition has to be agreed with another company, not your own.' },
      { status: 400 },
    )
  }

  const definition = await prisma.fieldDefinition.findUnique({
    where: { id: fieldDefinitionId },
    select: { id: true, version: true, label: true, domain: true, effectiveTo: true },
  })
  if (!definition) {
    return NextResponse.json({ error: 'That definition does not exist.' }, { status: 404 })
  }
  if (definition.effectiveTo !== null) {
    // Agreeing a retired wording would produce an agreement that is SUPERSEDED
    // the moment it is signed.
    return NextResponse.json(
      { error: 'That wording has been replaced. Agree the current version instead.' },
      { status: 409 },
    )
  }

  // Which way round is the relationship? Derived from the live grants, never
  // from what the caller claims.
  const grant = await prisma.dataAccessGrant.findFirst({
    where: {
      isActive: true,
      revokedAt: null,
      OR: [
        { grantorEntityId: entityId, granteeEntityId: counterpartyEntityId },
        { grantorEntityId: counterpartyEntityId, granteeEntityId: entityId },
      ],
    },
    select: { grantorEntityId: true, granteeEntityId: true },
  })
  if (!grant) {
    return NextResponse.json(
      { error: 'You can only agree definitions with a company you already share data with.' },
      { status: 403 },
    )
  }

  const supplierEntityId = grant.grantorEntityId
  const buyerEntityId = grant.granteeEntityId

  const existing = await prisma.definitionAgreement.findUnique({
    where: {
      fieldDefinitionId_supplierEntityId_buyerEntityId: {
        fieldDefinitionId,
        supplierEntityId,
        buyerEntityId,
      },
    },
    select: { id: true, status: true },
  })
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.status === 'ACCEPTED'
            ? 'This wording is already agreed with that company.'
            : 'This wording has already been put to that company.',
        agreementId: existing.id,
      },
      { status: 409 },
    )
  }

  const proposer = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { legalName: true },
  })

  const agreement = await prisma.definitionAgreement.create({
    data: {
      fieldDefinitionId,
      definitionVersion: definition.version,
      supplierEntityId,
      buyerEntityId,
      status: 'PROPOSED',
      proposedByEntityId: entityId,
      proposedById: user.id as string,
      note: note ?? null,
    },
    select: { id: true },
  })

  await sendNotification({
    entityId: counterpartyEntityId,
    type: 'DEFINITION_PROPOSED',
    payload: {
      fieldDefinitionId,
      fieldLabel: definition.label,
      domain: definition.domain,
      proposedByName: proposer?.legalName ?? 'A company you share data with',
    },
  })

  return NextResponse.json({ agreementId: agreement.id, status: 'PROPOSED' }, { status: 201 })
}
