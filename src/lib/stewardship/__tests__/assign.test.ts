// A ValidationFlag with no owner is nobody's job. The store can already say
// "this record is internally inconsistent" — until now it could not say who is
// accountable for resolving that, which is the difference between a quality
// signal and a quality control.
//
// Pure policy: given the entity's stewards and admins, decide who owns a flag.
// No DB, no side effects — the impure caller does the write.

import { resolveFlagOwner, type StewardAssignment, type EntityAdmin } from '../assign'

const ENTITY = 'ent-1'

const energySteward: StewardAssignment = {
  entityId: ENTITY,
  domain: 'ENERGY',
  userId: 'user-energy',
}

const admins: EntityAdmin[] = [
  { entityId: ENTITY, userId: 'user-admin-late', createdAt: new Date('2026-05-01T00:00:00.000Z') },
  { entityId: ENTITY, userId: 'user-admin-early', createdAt: new Date('2026-01-01T00:00:00.000Z') },
]

describe('resolveFlagOwner', () => {
  it('routes a flag to the steward for that record’s domain', () => {
    const got = resolveFlagOwner({
      entityId: ENTITY,
      domain: 'ENERGY',
      stewards: [energySteward],
      admins,
    })
    expect(got.userId).toBe('user-energy')
    expect(got.via).toBe('STEWARD')
  })

  it('falls back to an entity admin when that domain has no steward', () => {
    // Accountability must never fall through to nobody. A gap in stewardship is
    // an escalation, not a silent drop.
    const got = resolveFlagOwner({
      entityId: ENTITY,
      domain: 'LOGISTICS',
      stewards: [energySteward],
      admins,
    })
    expect(got.userId).toBe('user-admin-early')
    expect(got.via).toBe('ENTITY_ADMIN')
  })

  it('picks the longest-standing admin deterministically when several exist', () => {
    const got = resolveFlagOwner({ entityId: ENTITY, domain: 'WASTE_AND_WATER', stewards: [], admins })
    expect(got.userId).toBe('user-admin-early')
  })

  it('breaks a createdAt tie by userId so the choice is never arbitrary', () => {
    const sameDay: EntityAdmin[] = [
      { entityId: ENTITY, userId: 'user-b', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { entityId: ENTITY, userId: 'user-a', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ]
    const got = resolveFlagOwner({ entityId: ENTITY, domain: 'ENERGY', stewards: [], admins: sameDay })
    expect(got.userId).toBe('user-a')
  })

  it('ignores a steward belonging to a different entity', () => {
    const foreign: StewardAssignment = { entityId: 'ent-other', domain: 'ENERGY', userId: 'user-foreign' }
    const got = resolveFlagOwner({ entityId: ENTITY, domain: 'ENERGY', stewards: [foreign], admins })
    expect(got.userId).toBe('user-admin-early')
    expect(got.via).toBe('ENTITY_ADMIN')
  })

  it('ignores an admin belonging to a different entity', () => {
    const foreign: EntityAdmin[] = [
      { entityId: 'ent-other', userId: 'user-foreign', createdAt: new Date('2020-01-01T00:00:00.000Z') },
    ]
    const got = resolveFlagOwner({ entityId: ENTITY, domain: 'ENERGY', stewards: [], admins: foreign })
    expect(got.via).toBe('UNASSIGNED')
  })

  it('reports UNASSIGNED rather than guessing when there is no steward and no admin', () => {
    const got = resolveFlagOwner({ entityId: ENTITY, domain: 'ENERGY', stewards: [], admins: [] })
    expect(got.userId).toBeNull()
    expect(got.via).toBe('UNASSIGNED')
  })
})
