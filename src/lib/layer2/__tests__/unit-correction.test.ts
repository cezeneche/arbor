import { planUnitCorrections, applyUnitCorrection, type StoredRecord } from '../unit-correction'

// Records written before every path stored canonical units. They are corrected
// the way every correction in Arbor is: a new record superseding the old one,
// with its own audit entry. The original is never edited or deleted.

function rec(over: Partial<StoredRecord>): StoredRecord {
  return {
    id: 'rec-1',
    entityId: 'ent-1',
    domain: 'MATERIALS',
    fieldName: 'net_mass',
    value: 12,
    unit: 'KG',
    originalValue: 12,
    originalUnit: 'KG',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-04-01T00:00:00Z'),
    trustTier: 'B',
    extractionMethod: 'DOCUMENT_AI',
    submittedById: 'user-1',
    confidenceScore: 0.9,
    sourceText: 'Net mass 12 KG',
    documentId: 'doc-1',
    staleAfterDate: null,
    ...over,
  }
}

describe('planUnitCorrections', () => {
  it('finds records whose stored unit is not canonical, and what they become', () => {
    const plan = planUnitCorrections([
      rec({ id: 'a', value: 12, unit: 'KG' }),
      rec({ id: 'b', value: 3, unit: 'cu.m' }),
      rec({ id: 'c', value: 360, unit: 'mj' }),
    ])
    expect(plan.corrections).toEqual([
      { id: 'a', from: { value: 12, unit: 'KG' }, to: { value: 12, unit: 'kg' } },
      { id: 'b', from: { value: 3, unit: 'cu.m' }, to: { value: 3, unit: 'm3' } },
    ])
    expect(plan.unconvertible).toEqual([])
  })

  it('lists records it cannot convert, and leaves them alone', () => {
    const plan = planUnitCorrections([rec({ id: 'x', unit: 'furlongs' })])
    expect(plan.corrections).toEqual([])
    expect(plan.unconvertible).toEqual([{ id: 'x', unit: 'furlongs' }])
  })
})

describe('applyUnitCorrection', () => {
  beforeAll(() => {
    process.env.AUDIT_CHAIN_SECRET = 'test-secret'
  })

  function fakeTx(existing: StoredRecord) {
    const created: Record<string, unknown>[] = []
    const updates: { where: unknown; data: Record<string, unknown> }[] = []
    const audits: { eventType: string }[] = []
    return {
      created,
      updates,
      audits,
      dataRecord: {
        findFirst: jest.fn(async () => existing),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          return { id: 'rec-new' }
        }),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push(args)
          return { count: 1 }
        }),
      },
      auditEntry: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: { eventType: string } }) => {
          audits.push(data)
          return {}
        }),
      },
    }
  }

  it('writes a canonical successor and retires the original, keeping everything else', async () => {
    const tx = fakeTx(rec({ id: 'old', value: 3, unit: 'cu.m', originalValue: 3, originalUnit: 'cu.m' }))
    const out = await applyUnitCorrection(tx as never, 'old')

    expect(out).toEqual({ id: 'old', supersededBy: 'rec-new' })
    expect(tx.created[0]).toMatchObject({
      value: 3,
      unit: 'm3',
      originalValue: 3,
      originalUnit: 'cu.m',
      trustTier: 'B',
      documentId: 'doc-1',
      sourceText: 'Net mass 12 KG',
    })
    expect(tx.audits[0].eventType).toBe('UNIT_CANONICALISED')
    expect(tx.updates[0]).toEqual({
      where: { id: 'old', isActive: true },
      data: { isActive: false, supersededById: 'rec-new' },
    })
  })

  it('does nothing to a record that is already canonical or no longer active', async () => {
    const canonical = fakeTx(rec({ id: 'ok', value: 360, unit: 'mj' }))
    expect(await applyUnitCorrection(canonical as never, 'ok')).toBeNull()
    expect(canonical.created).toHaveLength(0)

    const gone = fakeTx(rec({}))
    gone.dataRecord.findFirst.mockResolvedValueOnce(null as never)
    expect(await applyUnitCorrection(gone as never, 'rec-1')).toBeNull()
  })
})
