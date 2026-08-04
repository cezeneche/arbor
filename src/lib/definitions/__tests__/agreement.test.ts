// A definition on its own is Arbor's declaration. An *agreed* definition is a
// bilateral fact: this supplier and this buyer both went on record that they mean
// the same thing by a field. That is the difference between metadata and a shared
// business definition, and it is what makes a number comparable across two
// organisations' systems.
//
// Agreement is keyed to a definition VERSION, never to a field name. If the
// boundary changes, the old agreement does not silently carry forward — the pair
// agreed the old meaning, not the new one.

import {
  resolveAgreementFor,
  agreementLabel,
  canRespondToProposal,
  type StoredAgreement,
} from '../agreement'

const SUPPLIER = 'ent-supplier'
const BUYER = 'ent-buyer'

const accepted: StoredAgreement = {
  id: 'agr-1',
  fieldDefinitionId: 'def-1',
  definitionVersion: 1,
  supplierEntityId: SUPPLIER,
  buyerEntityId: BUYER,
  status: 'ACCEPTED',
  proposedByEntityId: BUYER,
  respondedAt: new Date('2026-02-01T00:00:00.000Z'),
}

describe('resolveAgreementFor', () => {
  it('reports NONE when the pair has never discussed this definition', () => {
    const got = resolveAgreementFor([], {
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('NONE')
    expect(got.agreedVersion).toBeNull()
  })

  it('reports AGREED for the exact definition version both sides accepted', () => {
    const got = resolveAgreementFor([accepted], {
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('AGREED')
    expect(got.agreedVersion).toBe(1)
    expect(got.agreedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'))
  })

  it('reports SUPERSEDED when the pair agreed an earlier version but not this one', () => {
    // The single most important case. The buyer agreed what "electricity used"
    // meant under v1; v2 widened it to include on-site generation. Reporting this
    // as AGREED would export a number under a definition nobody signed off.
    const got = resolveAgreementFor([accepted], {
      fieldDefinitionId: 'def-2',
      definitionVersion: 2,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('SUPERSEDED')
    expect(got.agreedVersion).toBe(1)
  })

  it('does not treat another buyer’s agreement as this buyer’s', () => {
    const got = resolveAgreementFor([accepted], {
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: 'ent-other-buyer',
    })
    expect(got.status).toBe('NONE')
  })

  it('does not treat another supplier’s agreement as this supplier’s', () => {
    const got = resolveAgreementFor([accepted], {
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: 'ent-other-supplier',
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('NONE')
  })

  it('reports PROPOSED while one side is still waiting on the other', () => {
    const pending: StoredAgreement = { ...accepted, status: 'PROPOSED', respondedAt: null }
    const got = resolveAgreementFor([pending], {
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('PROPOSED')
    expect(got.agreedVersion).toBeNull()
  })

  it('reports NOT_AGREED when the counterparty rejected it', () => {
    const rejected: StoredAgreement = { ...accepted, status: 'REJECTED' }
    const got = resolveAgreementFor([rejected], {
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('NOT_AGREED')
  })

  it('a rejected earlier version does not count as a superseding agreement', () => {
    const rejected: StoredAgreement = { ...accepted, status: 'REJECTED' }
    const got = resolveAgreementFor([rejected], {
      fieldDefinitionId: 'def-2',
      definitionVersion: 2,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('NONE')
    expect(got.agreedVersion).toBeNull()
  })

  it('reports the highest agreed version when several earlier versions were agreed', () => {
    const alsoV2: StoredAgreement = {
      ...accepted,
      id: 'agr-2',
      fieldDefinitionId: 'def-2',
      definitionVersion: 2,
    }
    const got = resolveAgreementFor([accepted, alsoV2], {
      fieldDefinitionId: 'def-3',
      definitionVersion: 3,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
    })
    expect(got.status).toBe('SUPERSEDED')
    expect(got.agreedVersion).toBe(2)
  })
})

describe('agreementLabel', () => {
  it('speaks plain English on every state', () => {
    // These strings reach an SME office manager. No codes, no jargon (PRD §7).
    expect(agreementLabel('AGREED')).toBe('Agreed with your customer')
    expect(agreementLabel('PROPOSED')).toBe('Waiting for agreement')
    expect(agreementLabel('NOT_AGREED')).toBe('Not agreed')
    expect(agreementLabel('SUPERSEDED')).toBe('Agreed on an earlier wording')
    expect(agreementLabel('NONE')).toBe('No agreement yet')
  })
})

describe('canRespondToProposal', () => {
  const proposal: StoredAgreement = { ...accepted, status: 'PROPOSED', respondedAt: null }

  it('lets the counterparty accept or reject', () => {
    expect(canRespondToProposal(proposal, SUPPLIER).allowed).toBe(true)
  })

  it('refuses the entity that made the proposal — agreement needs two parties', () => {
    const got = canRespondToProposal(proposal, BUYER)
    expect(got.allowed).toBe(false)
    expect(got.reason).toMatch(/proposed/i)
  })

  it('refuses an entity that is neither the supplier nor the buyer', () => {
    expect(canRespondToProposal(proposal, 'ent-stranger').allowed).toBe(false)
  })

  it('refuses a second response once the proposal is settled', () => {
    const got = canRespondToProposal(accepted, SUPPLIER)
    expect(got.allowed).toBe(false)
    expect(got.reason).toMatch(/already/i)
  })
})
