// Turning a planned flag into an owned flag. Pure: the caller supplies the
// record→domain map, the stewards and the admins it already had to load, and
// gets back rows ready to write.
//
// Ownership is stamped at raise time rather than assigned later by someone
// triaging a queue, because a queue nobody owns is the thing being fixed.

import { planFlagOwnership, type RoutableFlag } from '../route-flags'
import type { StewardAssignment, EntityAdmin } from '../assign'

// A concrete planned flag, as the constraint and cross-validation callers build it.
interface PlannedFlag extends RoutableFlag {
  flagType: string
  message: string
}

const ENTITY = 'ent-1'
const NOW = new Date('2026-08-01T00:00:00.000Z')
const day = 24 * 60 * 60 * 1000

const stewards: StewardAssignment[] = [
  { entityId: ENTITY, domain: 'ENERGY', userId: 'user-energy' },
  { entityId: ENTITY, domain: 'LOGISTICS', userId: 'user-logistics' },
]

const admins: EntityAdmin[] = [
  { entityId: ENTITY, userId: 'user-admin', createdAt: new Date('2026-01-01T00:00:00.000Z') },
]

const domainByRecordId = new Map([
  ['rec-energy', 'ENERGY' as const],
  ['rec-logistics', 'LOGISTICS' as const],
  ['rec-waste', 'WASTE_AND_WATER' as const],
])

const flag = (over: Partial<PlannedFlag> & Pick<PlannedFlag, 'dataRecordId'>): PlannedFlag => ({
  severity: 'CRITICAL',
  flagType: 'INTERNAL_INCONSISTENCY',
  message: 'Mass balance does not close.',
  ...over,
})

describe('planFlagOwnership', () => {
  it('routes each flag by the domain of the record it sits on', () => {
    const [energy, logistics] = planFlagOwnership(
      [flag({ dataRecordId: 'rec-energy' }), flag({ dataRecordId: 'rec-logistics' })],
      { entityId: ENTITY, domainByRecordId, stewards, admins, now: NOW },
    )
    expect(energy.assigneeId).toBe('user-energy')
    expect(logistics.assigneeId).toBe('user-logistics')
  })

  it('falls back to the entity admin for a domain with no steward', () => {
    const [waste] = planFlagOwnership([flag({ dataRecordId: 'rec-waste' })], {
      entityId: ENTITY,
      domainByRecordId,
      stewards,
      admins,
      now: NOW,
    })
    expect(waste.assigneeId).toBe('user-admin')
    expect(waste.assignedVia).toBe('ENTITY_ADMIN')
  })

  it('sets a proportionate deadline from the severity', () => {
    const [critical, warning] = planFlagOwnership(
      [
        flag({ dataRecordId: 'rec-energy', severity: 'CRITICAL' }),
        flag({ dataRecordId: 'rec-energy', severity: 'WARNING' }),
      ],
      { entityId: ENTITY, domainByRecordId, stewards, admins, now: NOW },
    )
    expect(critical.dueAt).toEqual(new Date(NOW.getTime() + 3 * day))
    expect(warning.dueAt).toEqual(new Date(NOW.getTime() + 14 * day))
  })

  it('gives an INFO flag an owner but no deadline', () => {
    // Someone is still accountable; they are simply not on the clock.
    const [info] = planFlagOwnership(
      [flag({ dataRecordId: 'rec-energy', severity: 'INFO' })],
      { entityId: ENTITY, domainByRecordId, stewards, admins, now: NOW },
    )
    expect(info.assigneeId).toBe('user-energy')
    expect(info.dueAt).toBeNull()
  })

  it('leaves a flag unowned and undated when the entity has nobody to own it', () => {
    const [orphan] = planFlagOwnership([flag({ dataRecordId: 'rec-energy' })], {
      entityId: ENTITY,
      domainByRecordId,
      stewards: [],
      admins: [],
      now: NOW,
    })
    expect(orphan.assigneeId).toBeNull()
    expect(orphan.assignedVia).toBeNull()
    expect(orphan.assignedAt).toBeNull()
    // No owner means no clock — an SLA against nobody is theatre.
    expect(orphan.dueAt).toBeNull()
  })

  it('leaves a flag unowned when the record’s domain is unknown', () => {
    const [unknown] = planFlagOwnership([flag({ dataRecordId: 'rec-missing' })], {
      entityId: ENTITY,
      domainByRecordId,
      stewards,
      admins,
      now: NOW,
    })
    expect(unknown.assigneeId).toBeNull()
  })

  it('preserves every field the caller planned', () => {
    const [got] = planFlagOwnership(
      [flag({ dataRecordId: 'rec-energy', message: 'Negative mass.' })],
      { entityId: ENTITY, domainByRecordId, stewards, admins, now: NOW },
    )
    expect(got.message).toBe('Negative mass.')
    expect(got.flagType).toBe('INTERNAL_INCONSISTENCY')
    expect(got.dataRecordId).toBe('rec-energy')
  })

  it('handles an empty plan without touching anything', () => {
    expect(
      planFlagOwnership([], { entityId: ENTITY, domainByRecordId, stewards, admins, now: NOW }),
    ).toEqual([])
  })
})
