// Layer 3. Trust tier already travels with every data point in every output
// (PRD §13, §21.2). The definition must travel the same way: a buyer receiving
// "total_consumption_kwh = 480000 MJ" cannot use it responsibly without knowing
// what was counted, what was excluded, and whether they ever agreed that wording.
//
// Read-only and pure: it decorates records with metadata that already exists in
// the store. It changes no value, converts no unit, and drops no record.

import { attachDefinitions, type DecorableRecord } from '../attach-definitions'
import type { StoredFieldDefinition } from '@/lib/definitions/registry'
import type { StoredAgreement } from '@/lib/definitions/agreement'

const iso = (s: string) => new Date(s)
const SUPPLIER = 'ent-supplier'
const BUYER = 'ent-buyer'

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
  boundary: 'Includes all metered import and on-site generation consumed directly.',
}

const marchRecord: DecorableRecord = {
  id: 'rec-march',
  entityId: SUPPLIER,
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  submittedAt: iso('2026-03-10T00:00:00.000Z'),
}

const julyRecord: DecorableRecord = {
  ...marchRecord,
  id: 'rec-july',
  submittedAt: iso('2026-07-10T00:00:00.000Z'),
}

describe('attachDefinitions', () => {
  it('attaches the definition that was in force when the record was submitted', () => {
    // Not today's definition. The March record was certified under v1 and must
    // keep carrying v1's boundary text for the rest of its life.
    const [march, july] = attachDefinitions([marchRecord, julyRecord], {
      definitions: [v1, v2],
      agreements: [],
      buyerEntityId: BUYER,
    })

    expect(march.definition?.version).toBe(1)
    expect(march.definition?.boundary).toContain('Excludes on-site generation')
    expect(july.definition?.version).toBe(2)
    expect(july.definition?.boundary).toContain('and on-site generation')
  })

  it('carries the agreement state for the receiving buyer', () => {
    const agreed: StoredAgreement = {
      id: 'agr-1',
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
      status: 'ACCEPTED',
      proposedByEntityId: BUYER,
      respondedAt: iso('2026-02-01T00:00:00.000Z'),
    }

    const [march] = attachDefinitions([marchRecord], {
      definitions: [v1, v2],
      agreements: [agreed],
      buyerEntityId: BUYER,
    })

    expect(march.agreement.status).toBe('AGREED')
    expect(march.agreement.label).toBe('Agreed with your customer')
  })

  it('flags a record whose definition moved on since the buyer agreed it', () => {
    const agreedV1: StoredAgreement = {
      id: 'agr-1',
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
      status: 'ACCEPTED',
      proposedByEntityId: BUYER,
      respondedAt: iso('2026-02-01T00:00:00.000Z'),
    }

    const [july] = attachDefinitions([julyRecord], {
      definitions: [v1, v2],
      agreements: [agreedV1],
      buyerEntityId: BUYER,
    })

    expect(july.agreement.status).toBe('SUPERSEDED')
    expect(july.agreement.agreedVersion).toBe(1)
  })

  it('marks a record with no governed definition honestly rather than inventing one', () => {
    const undefinedField: DecorableRecord = {
      ...marchRecord,
      id: 'rec-undefined',
      fieldName: 'some_ungoverned_field',
    }

    const [got] = attachDefinitions([undefinedField], {
      definitions: [v1, v2],
      agreements: [],
      buyerEntityId: BUYER,
    })

    expect(got.definition).toBeNull()
    expect(got.agreement.status).toBe('NONE')
    expect(got.agreement.label).toBe('No agreement yet')
  })

  it('never drops or reorders records — decoration only', () => {
    const got = attachDefinitions([julyRecord, marchRecord], {
      definitions: [v1, v2],
      agreements: [],
      buyerEntityId: BUYER,
    })
    expect(got.map(r => r.id)).toEqual(['rec-july', 'rec-march'])
  })

  it('leaves every stored value untouched', () => {
    // Layer 3 is read-only. This guards against a future edit that "helpfully"
    // rounds or converts while decorating.
    const withValue = { ...marchRecord, value: 480000, unit: 'MJ' }
    const [got] = attachDefinitions([withValue], {
      definitions: [v1, v2],
      agreements: [],
      buyerEntityId: BUYER,
    })
    expect(got.value).toBe(480000)
    expect(got.unit).toBe('MJ')
  })

  it('resolves agreement per supplier — one buyer, two suppliers, different states', () => {
    const otherSupplierRecord: DecorableRecord = {
      ...marchRecord,
      id: 'rec-other',
      entityId: 'ent-supplier-2',
    }
    const agreedWithFirstOnly: StoredAgreement = {
      id: 'agr-1',
      fieldDefinitionId: 'def-1',
      definitionVersion: 1,
      supplierEntityId: SUPPLIER,
      buyerEntityId: BUYER,
      status: 'ACCEPTED',
      proposedByEntityId: BUYER,
      respondedAt: iso('2026-02-01T00:00:00.000Z'),
    }

    const [first, second] = attachDefinitions([marchRecord, otherSupplierRecord], {
      definitions: [v1, v2],
      agreements: [agreedWithFirstOnly],
      buyerEntityId: BUYER,
    })

    expect(first.agreement.status).toBe('AGREED')
    expect(second.agreement.status).toBe('NONE')
  })

  it('omits agreement resolution when there is no receiving buyer (supplier viewing own data)', () => {
    const [got] = attachDefinitions([marchRecord], {
      definitions: [v1, v2],
      agreements: [],
      buyerEntityId: null,
    })
    expect(got.definition?.version).toBe(1)
    expect(got.agreement.status).toBe('NOT_APPLICABLE')
  })
})
