import { writeRecordWithAuditEntry, InvalidRecordPeriodError, type RecordInput } from '../record-writer'
import { UnsupportedUnitError } from '../canonical-measurement'

// The shared writer is the one place every record is created, so it is where
// the storage rules live: canonical SI units and a period that does not run
// backwards. Rules held per route drift apart — the document path normalised
// units while manual entry, the API and integrations stored whatever arrived.

beforeAll(() => {
  process.env.AUDIT_CHAIN_SECRET = 'test-secret'
})

function fakeTx() {
  const records: Record<string, unknown>[] = []
  const audits: { payload: Record<string, unknown> }[] = []
  return {
    records,
    audits,
    dataRecord: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        records.push(data)
        return { id: `rec-${records.length}` }
      }),
      update: jest.fn(async () => ({})),
    },
    auditEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: { payload: Record<string, unknown> } }) => {
        audits.push(data)
        return {}
      }),
    },
  }
}

function input(over: Partial<RecordInput> = {}): RecordInput {
  return {
    entityId: 'ent-1',
    domain: 'ENERGY',
    fieldName: 'total_consumption_kwh',
    value: 100,
    unit: 'kwh',
    originalValue: 100,
    originalUnit: 'kwh',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-04-01T00:00:00Z'),
    trustTier: 'B',
    extractionMethod: 'MANUAL_ENTRY',
    submittedById: 'user-1',
    ...over,
  }
}

describe('writeRecordWithAuditEntry', () => {
  // Audit P1 #5: a manual 100 kWh reached storage as "100 kwh".
  it('stores a manual 100 kWh as 360 MJ, keeping what was entered as the original', async () => {
    const tx = fakeTx()
    await writeRecordWithAuditEntry(tx as never, input())
    expect(tx.records[0]).toMatchObject({ value: 360, unit: 'mj', originalValue: 100, originalUnit: 'kwh' })
  })

  it('chains the canonical figure, so the audit entry matches the stored record', async () => {
    const tx = fakeTx()
    await writeRecordWithAuditEntry(tx as never, input())
    expect(tx.audits[0].payload).toMatchObject({ value: 360, unit: 'mj', originalValue: 100, originalUnit: 'kwh' })
  })

  it('leaves an already-normalised figure from the document path unchanged', async () => {
    const tx = fakeTx()
    await writeRecordWithAuditEntry(tx as never, input({ value: 360, unit: 'mj' }))
    expect(tx.records[0]).toMatchObject({ value: 360, unit: 'mj', originalValue: 100, originalUnit: 'kwh' })
  })

  it('refuses a unit it cannot convert, and writes nothing', async () => {
    const tx = fakeTx()
    await expect(
      writeRecordWithAuditEntry(tx as never, input({ unit: 'furlongs', originalUnit: 'furlongs' })),
    ).rejects.toBeInstanceOf(UnsupportedUnitError)
    expect(tx.dataRecord.create).not.toHaveBeenCalled()
  })

  it('refuses a period that ends before it starts, and writes nothing', async () => {
    const tx = fakeTx()
    await expect(
      writeRecordWithAuditEntry(
        tx as never,
        input({ periodStart: new Date('2026-04-01'), periodEnd: new Date('2026-01-01') }),
      ),
    ).rejects.toBeInstanceOf(InvalidRecordPeriodError)
    expect(tx.dataRecord.create).not.toHaveBeenCalled()
  })

  // A transaction from an accounting system happens at an instant. A zero-length
  // period is a point in time, which is honest; a negative one is an error.
  it('accepts a point-in-time record whose period starts and ends together', async () => {
    const tx = fakeTx()
    const at = new Date('2026-02-14T00:00:00Z')
    await writeRecordWithAuditEntry(
      tx as never,
      input({ periodStart: at, periodEnd: at, extractionMethod: 'SYSTEM_INTEGRATION' }),
    )
    expect(tx.records).toHaveLength(1)
  })
})
