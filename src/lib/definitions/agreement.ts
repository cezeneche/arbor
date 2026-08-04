// Bilateral definition agreement. Pure: no DB, no side effects.
//
// A published definition is Arbor's declaration of what a field means. An agreed
// definition is a fact about two organisations: this supplier and this buyer are
// both on record that they mean the same thing by it. Only the second makes a
// number safely comparable across their two systems, which is why the store keeps
// them apart rather than treating "we wrote it down" as consensus.
//
// Agreement binds to a definition VERSION, never to a field name. When the
// boundary changes, the earlier agreement does not carry forward — the pair
// agreed the old wording, and saying otherwise would export a number under terms
// nobody signed off. That state has its own name (SUPERSEDED) because it is
// materially different from never having discussed it.

export type StoredAgreementStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN'

export interface StoredAgreement {
  id: string
  fieldDefinitionId: string
  /** Denormalised from the definition so ordering by version needs no join. */
  definitionVersion: number
  supplierEntityId: string
  buyerEntityId: string
  status: StoredAgreementStatus
  /** Either side may open the conversation; only the other side may answer it. */
  proposedByEntityId: string
  respondedAt: Date | null
}

export type AgreementState =
  | 'AGREED'
  | 'PROPOSED'
  | 'NOT_AGREED'
  | 'SUPERSEDED'
  | 'NONE'
  /** No counterparty in view — a supplier reading their own data. */
  | 'NOT_APPLICABLE'

export interface AgreementResolution {
  status: AgreementState
  /** Highest version this pair has actually accepted, if any. */
  agreedVersion: number | null
  agreedAt: Date | null
}

export interface AgreementLookup {
  fieldDefinitionId: string
  definitionVersion: number
  supplierEntityId: string
  buyerEntityId: string
}

const NONE: AgreementResolution = { status: 'NONE', agreedVersion: null, agreedAt: null }

/**
 * The agreement state between one supplier and one buyer for one definition
 * version. Never infers consent from an adjacent version — it reports
 * SUPERSEDED instead, so the gap is visible rather than papered over.
 */
export function resolveAgreementFor(
  agreements: StoredAgreement[],
  lookup: AgreementLookup,
): AgreementResolution {
  const forPair = agreements.filter(
    a =>
      a.supplierEntityId === lookup.supplierEntityId &&
      a.buyerEntityId === lookup.buyerEntityId,
  )

  const exact = forPair.find(a => a.fieldDefinitionId === lookup.fieldDefinitionId)
  if (exact) {
    switch (exact.status) {
      case 'ACCEPTED':
        return { status: 'AGREED', agreedVersion: exact.definitionVersion, agreedAt: exact.respondedAt }
      case 'PROPOSED':
        return { status: 'PROPOSED', agreedVersion: null, agreedAt: null }
      case 'REJECTED':
        return { status: 'NOT_AGREED', agreedVersion: null, agreedAt: null }
      case 'WITHDRAWN':
        return { status: 'NONE', agreedVersion: null, agreedAt: null }
    }
  }

  // Nothing on this version. Did they agree an earlier wording of the same field?
  const earlierAccepted = forPair.filter(
    a => a.status === 'ACCEPTED' && a.definitionVersion < lookup.definitionVersion,
  )
  if (earlierAccepted.length === 0) return NONE

  const newest = earlierAccepted.reduce((best, a) =>
    a.definitionVersion > best.definitionVersion ? a : best,
  )
  return { status: 'SUPERSEDED', agreedVersion: newest.definitionVersion, agreedAt: newest.respondedAt }
}

const LABELS: Record<AgreementState, string> = {
  AGREED: 'Agreed with your customer',
  PROPOSED: 'Waiting for agreement',
  NOT_AGREED: 'Not agreed',
  SUPERSEDED: 'Agreed on an earlier wording',
  NONE: 'No agreement yet',
  NOT_APPLICABLE: 'Your own data',
}

/** Plain English for every state — these strings reach SME users (PRD §7). */
export function agreementLabel(state: AgreementState): string {
  return LABELS[state]
}

export interface RespondPermission {
  allowed: boolean
  reason?: string
}

/**
 * Only the counterparty may answer a proposal. An entity accepting its own
 * proposal would make "agreed" a unilateral claim, which is the exact failure
 * mode this feature exists to close.
 */
export function canRespondToProposal(
  agreement: StoredAgreement,
  respondingEntityId: string,
): RespondPermission {
  const isParty =
    respondingEntityId === agreement.supplierEntityId ||
    respondingEntityId === agreement.buyerEntityId
  if (!isParty) {
    return { allowed: false, reason: 'Only the supplier or the buyer named on this definition can respond.' }
  }
  if (respondingEntityId === agreement.proposedByEntityId) {
    return { allowed: false, reason: 'You proposed this wording — the other party has to agree it.' }
  }
  if (agreement.status !== 'PROPOSED') {
    return { allowed: false, reason: 'This wording has already been answered.' }
  }
  return { allowed: true }
}
