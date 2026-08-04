// The governed data dictionary is versioned with effective dates, exactly like a
// DataRecord is versioned by supersession: a definition is never edited in place.
// The reason is the whole point of the feature — a record certified in March under
// v1 of "total_consumption_kwh" must keep meaning what v1 said, even after v2
// narrows the boundary in June. If definitions were mutable, every historical
// record would silently acquire a new meaning and the certified store would be
// lying about what it holds.

import {
  resolveDefinitionAsOf,
  planNewVersion,
  currentDefinitions,
  type StoredFieldDefinition,
} from '../registry'

const iso = (s: string) => new Date(s)

const v1: StoredFieldDefinition = {
  id: 'def-1',
  fieldName: 'total_consumption_kwh',
  domain: 'ENERGY',
  version: 1,
  effectiveFrom: iso('2026-01-01T00:00:00.000Z'),
  effectiveTo: iso('2026-06-01T00:00:00.000Z'),
  label: 'Electricity used',
  definition: 'Total electricity drawn from the grid at the site over the billing period.',
  boundary: 'Includes all metered import. Excludes on-site generation consumed directly.',
  canonicalUnit: 'MJ',
  admissibility: 'COMPULSORY',
  sourceStandard: 'Arbor Admissibility Spec v1.0',
}

const v2: StoredFieldDefinition = {
  ...v1,
  id: 'def-2',
  version: 2,
  effectiveFrom: iso('2026-06-01T00:00:00.000Z'),
  effectiveTo: null,
  boundary:
    'Includes all metered import AND on-site generation consumed directly. Excludes exported energy.',
}

const otherDomain: StoredFieldDefinition = {
  ...v1,
  id: 'def-3',
  domain: 'PRODUCTION',
  version: 1,
  effectiveFrom: iso('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
}

describe('resolveDefinitionAsOf', () => {
  it('returns the version in effect at the instant asked for, not the newest one', () => {
    // A record submitted in March carries March's meaning forever.
    const got = resolveDefinitionAsOf([v1, v2], {
      fieldName: 'total_consumption_kwh',
      domain: 'ENERGY',
      asOf: iso('2026-03-15T00:00:00.000Z'),
    })
    expect(got?.version).toBe(1)
    expect(got?.boundary).toContain('Excludes on-site generation')
  })

  it('returns the open-ended current version for an instant after the last cutover', () => {
    const got = resolveDefinitionAsOf([v1, v2], {
      fieldName: 'total_consumption_kwh',
      domain: 'ENERGY',
      asOf: iso('2026-08-04T00:00:00.000Z'),
    })
    expect(got?.version).toBe(2)
  })

  it('treats effectiveTo as exclusive so a cutover instant matches exactly one version', () => {
    const got = resolveDefinitionAsOf([v1, v2], {
      fieldName: 'total_consumption_kwh',
      domain: 'ENERGY',
      asOf: iso('2026-06-01T00:00:00.000Z'),
    })
    expect(got?.version).toBe(2)
  })

  it('returns null for an instant before the first version took effect', () => {
    // Honest absence. A record older than the dictionary has no agreed definition,
    // and inventing one would be the exact failure this feature exists to stop.
    const got = resolveDefinitionAsOf([v1, v2], {
      fieldName: 'total_consumption_kwh',
      domain: 'ENERGY',
      asOf: iso('2025-12-31T23:59:59.999Z'),
    })
    expect(got).toBeNull()
  })

  it('returns null when the field has no definition at all', () => {
    const got = resolveDefinitionAsOf([v1, v2], {
      fieldName: 'unknown_field',
      domain: 'ENERGY',
      asOf: iso('2026-08-04T00:00:00.000Z'),
    })
    expect(got).toBeNull()
  })

  it('does not match a same-named field in a different domain', () => {
    // field_name is only unique within a domain — "quantity" means different
    // things in MATERIALS and WASTE_AND_WATER.
    const got = resolveDefinitionAsOf([otherDomain], {
      fieldName: 'total_consumption_kwh',
      domain: 'ENERGY',
      asOf: iso('2026-08-04T00:00:00.000Z'),
    })
    expect(got).toBeNull()
  })

  it('prefers the highest version when two rows share an effectiveFrom', () => {
    // Defensive: a bad backfill must resolve deterministically, never arbitrarily.
    const dupe: StoredFieldDefinition = { ...v2, id: 'def-2b', version: 3 }
    const got = resolveDefinitionAsOf([v2, dupe], {
      fieldName: 'total_consumption_kwh',
      domain: 'ENERGY',
      asOf: iso('2026-08-04T00:00:00.000Z'),
    })
    expect(got?.version).toBe(3)
  })
})

describe('currentDefinitions', () => {
  it('returns one row per field+domain — the version in effect now', () => {
    const got = currentDefinitions([v1, v2, otherDomain], iso('2026-08-04T00:00:00.000Z'))
    expect(got).toHaveLength(2)
    expect(got.find(d => d.domain === 'ENERGY')?.version).toBe(2)
    expect(got.find(d => d.domain === 'PRODUCTION')?.version).toBe(1)
  })

  it('omits fields whose definition has been retired', () => {
    const retired: StoredFieldDefinition = {
      ...v1,
      id: 'def-retired',
      fieldName: 'legacy_field',
      effectiveTo: iso('2026-02-01T00:00:00.000Z'),
    }
    const got = currentDefinitions([retired], iso('2026-08-04T00:00:00.000Z'))
    expect(got).toHaveLength(0)
  })
})

describe('planNewVersion', () => {
  it('numbers the first version 1 and leaves it open-ended', () => {
    const plan = planNewVersion([], { effectiveFrom: iso('2026-01-01T00:00:00.000Z') })
    expect(plan.version).toBe(1)
    expect(plan.closesDefinitionId).toBeNull()
  })

  it('increments the version and closes the prior one at the new effectiveFrom', () => {
    // No gap and no overlap: the old meaning ends exactly where the new one begins.
    const plan = planNewVersion([v1, v2], { effectiveFrom: iso('2026-09-01T00:00:00.000Z') })
    expect(plan.version).toBe(3)
    expect(plan.closesDefinitionId).toBe('def-2')
    expect(plan.closesAt).toEqual(iso('2026-09-01T00:00:00.000Z'))
  })

  it('refuses an effectiveFrom at or before the current version started', () => {
    // Backdating would retroactively rewrite what already-certified records mean.
    expect(() =>
      planNewVersion([v1, v2], { effectiveFrom: iso('2026-05-01T00:00:00.000Z') }),
    ).toThrow(/effectiveFrom/i)
  })
})
