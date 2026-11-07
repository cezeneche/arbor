import { checkFlagResolution, resolveFlag, type FlaggedRecord, type OpenFlag } from '../flag-resolution'

// A supplier settles a flag on one of their own records, from Review. Two
// outcomes, both written the way Arbor writes everything:
//
//   keep    — the value stands. The flag is resolved with the supplier's note,
//             and the note goes into the audit chain (PRD 12.3 "Accepted").
//             Not for a critical flag: the admissibility spec resolves those
//             with evidence, so the supplier corrects or uploads instead.
//   correct — a new record supersedes the old one (PRD 20.3). It is Declared,
//             because a typed value has no document behind it. The old record
//             is kept, inactive, and its open flags close with it.
//
// Neither changes a tier on an existing record. Tiers are set at write time.

function record(over: Partial<FlaggedRecord> = {}): FlaggedRecord {
  return {
    id: 'rec-1',
    entityId: 'org',
    isActive: true,
    domain: 'ENERGY',
    fieldName: 'electricity_kwh',
    value: 41200,
    unit: 'kWh',
    originalValue: 41200,
    originalUnit: 'kWh',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-09-30T00:00:00Z'),
    trustTier: 'A',
    extractionMethod: 'DOCUMENT_AI',
    submittedById: 'u0',
    confidenceScore: 0.97,
    sourceText: 'Total units 41,200 kWh',
    documentId: 'doc-1',
    staleAfterDate: null,
    ...over,
  }
}

function flag(over: Partial<OpenFlag> = {}): OpenFlag {
  return {
    id: 'flag-1',
    severity: 'WARNING',
    flagType: 'CROSS_DOC_DISCREPANCY',
    raisedByEntityId: null,
    dataRecord: record(),
    ...over,
  }
}

// What the route needs after the write commits: to tell a disputing buyer, and
// to learn from a correction of a value the model read.
const BEFORE = {
  id: 'rec-1',
  fieldName: 'electricity_kwh',
  domain: 'ENERGY',
  documentId: 'doc-1',
  extractionMethod: 'DOCUMENT_AI',
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-09-30T00:00:00Z'),
}

describe('checkFlagResolution', () => {
  it('lets a supplier keep a value with a note', () => {
    expect(
      checkFlagResolution(flag(), { action: 'keep', note: 'The meter was replaced in August.' }),
    ).toBeNull()
  })

  it('needs a note to keep a value', () => {
    expect(checkFlagResolution(flag(), { action: 'keep', note: '   ' })).toBe('NOTE_REQUIRED')
  })

  it('refuses to wave a critical flag through with a note', () => {
    const critical = flag({ severity: 'CRITICAL', flagType: 'EXPIRED_CERTIFICATE' })
    expect(checkFlagResolution(critical, { action: 'keep', note: 'Renewal is in hand.' })).toBe(
      'NEEDS_EVIDENCE',
    )
  })

  it('lets a critical flag be corrected', () => {
    expect(
      checkFlagResolution(flag({ severity: 'CRITICAL' }), { action: 'correct', value: 44900 }),
    ).toBeNull()
  })

  it('refuses a correction that is not a number', () => {
    expect(checkFlagResolution(flag(), { action: 'correct', value: Number.NaN })).toBe('INVALID_VALUE')
  })

  it('refuses a correction that changes nothing', () => {
    expect(checkFlagResolution(flag(), { action: 'correct', value: 41200 })).toBe('UNCHANGED')
  })

  it('treats a missing flag as not found', () => {
    expect(checkFlagResolution(null, { action: 'correct', value: 1 })).toBe('NOT_FOUND')
  })
})

describe('resolveFlag', () => {
  beforeAll(() => {
    process.env.AUDIT_CHAIN_SECRET = 'test-secret'
  })

  const NOW = new Date('2026-11-07T12:00:00Z')

  function fakeTx(found: OpenFlag | null) {
    const audits: { eventType: string; recordId: string; payload: Record<string, unknown> }[] = []
    const created: Record<string, unknown>[] = []
    const recordUpdates: { where: unknown; data: unknown }[] = []
    const flagUpdates: { where: unknown; data: unknown }[] = []
    const tx = {
      validationFlag: {
        findFirst: jest.fn(async (args: unknown) => (args ? found : null)),
        updateMany: jest.fn(async (args: { where: unknown; data: unknown }) => {
          flagUpdates.push(args)
          return { count: 1 }
        }),
      },
      dataRecord: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          return { id: 'rec-new' }
        }),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async (args: { where: unknown; data: unknown }) => {
          recordUpdates.push(args)
          return { count: 1 }
        }),
      },
      auditEntry: {
        findFirst: jest.fn(async () => ({ hash: 'tail', sequence: 7 })),
        create: jest.fn(async ({ data }: { data: (typeof audits)[number] }) => {
          audits.push(data)
          return {}
        }),
      },
    }
    return { tx, audits, created, recordUpdates, flagUpdates }
  }

  it('looks the flag up only among open flags on the organisation’s active records', async () => {
    const { tx } = fakeTx(flag())
    await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'keep', note: 'Checked.' },
      now: NOW,
    })
    expect(tx.validationFlag.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'flag-1', resolvedAt: null, dataRecord: { entityId: 'org', isActive: true } },
      }),
    )
  })

  it('keeps a value: resolves the flag with the note and records it in the audit chain', async () => {
    const { tx, audits, created, flagUpdates } = fakeTx(flag())
    const result = await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'keep', note: '  The meter was replaced in August.  ' },
      now: NOW,
    })
    expect(result).toEqual({ ok: true, action: 'kept', before: BEFORE, disputedBy: null })
    expect(created).toEqual([])
    expect(flagUpdates).toEqual([
      {
        where: { id: 'flag-1', resolvedAt: null },
        data: { resolvedAt: NOW, resolvedNote: 'The meter was replaced in August.' },
      },
    ])
    expect(audits).toHaveLength(1)
    expect(audits[0].eventType).toBe('FLAG_ACCEPTED')
    // Namespaced, like other non-record events, so it never claims to be the record's own entry.
    expect(audits[0].recordId).toBe('flag_flag-1')
    expect(audits[0].payload).toMatchObject({
      fieldName: 'electricity_kwh',
      value: 41200,
      sourceText: 'The meter was replaced in August.',
      submittedById: 'u1',
    })
  })

  it('corrects a value: a Declared record supersedes the old one, whose flags close', async () => {
    const { tx, audits, created, recordUpdates, flagUpdates } = fakeTx(flag())
    const result = await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'correct', value: 44900 },
      now: NOW,
    })
    expect(result).toEqual({
      ok: true,
      action: 'corrected',
      recordId: 'rec-new',
      before: BEFORE,
      disputedBy: null,
    })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      entityId: 'org',
      fieldName: 'electricity_kwh',
      originalValue: 44900,
      originalUnit: 'kWh',
      trustTier: 'B',
      extractionMethod: 'MANUAL_ENTRY',
      submittedById: 'u1',
      documentId: undefined,
    })
    expect(audits.map(a => a.eventType)).toEqual(['CORRECTED'])
    expect(recordUpdates).toEqual([
      { where: { id: 'rec-1', isActive: true }, data: { isActive: false, supersededById: 'rec-new' } },
    ])
    expect(flagUpdates).toEqual([
      {
        where: { dataRecordId: 'rec-1', resolvedAt: null },
        data: { resolvedAt: NOW, resolvedNote: 'Corrected: replaced by a new record.' },
      },
    ])
  })

  it('writes the correction in the unit the supplier saw, and stores it canonically', async () => {
    const { tx, created } = fakeTx(
      flag({ dataRecord: record({ value: 12000, unit: 'kg', originalValue: 12, originalUnit: 't' }) }),
    )
    await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'correct', value: 13 },
      now: NOW,
    })
    expect(created[0]).toMatchObject({ originalValue: 13, originalUnit: 't', value: 13000, unit: 'kg' })
  })

  it('uses the stored value and unit for an older record with no original', async () => {
    const legacy = record({ value: 148320, unit: 'mj', originalValue: null, originalUnit: null })
    expect(checkFlagResolution(flag({ dataRecord: legacy }), { action: 'correct', value: 148320 })).toBe(
      'UNCHANGED',
    )
    const { tx, created } = fakeTx(flag({ dataRecord: legacy }))
    await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'correct', value: 150000 },
      now: NOW,
    })
    expect(created[0]).toMatchObject({ originalValue: 150000, originalUnit: 'mj', value: 150000, unit: 'mj' })
  })

  it('names the buyer who raised a dispute, so they can be told the answer', async () => {
    const { tx } = fakeTx(flag({ flagType: 'BUYER_DISPUTED', raisedByEntityId: 'buyer-1' }))
    const result = await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'keep', note: 'Checked against the meter.' },
      now: NOW,
    })
    expect(result).toMatchObject({ ok: true, disputedBy: 'buyer-1' })
  })

  it('names no buyer for a flag a buyer did not raise', async () => {
    const { tx } = fakeTx(flag({ flagType: 'LOW_CONFIDENCE', raisedByEntityId: 'buyer-1' }))
    const result = await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'keep', note: 'Checked.' },
      now: NOW,
    })
    expect(result).toMatchObject({ ok: true, disputedBy: null })
  })

  it('writes nothing when it refuses', async () => {
    const { tx, audits, created, flagUpdates } = fakeTx(flag({ severity: 'CRITICAL' }))
    const result = await resolveFlag(tx as never, {
      flagId: 'flag-1',
      entityId: 'org',
      userId: 'u1',
      request: { action: 'keep', note: 'Fine.' },
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'NEEDS_EVIDENCE' })
    expect([...audits, ...created, ...flagUpdates]).toEqual([])
  })
})
