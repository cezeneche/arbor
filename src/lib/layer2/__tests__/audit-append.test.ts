import { appendAuditEntry, type AuditTxClient } from '../audit-append'
import { verifyChain, type AuditPayload } from '../audit-chain'

process.env.AUDIT_CHAIN_SECRET ??= 'test-secret'

interface StoredEntry {
  entityId: string
  recordId: string
  eventType: string
  payload: AuditPayload
  hash: string
  previousHash: string | null
  sequence: number
  createdAt: Date
}

/** Minimal in-memory stand-in for the Prisma transaction client. Deliberately
 *  stamps every entry with the SAME createdAt — that is the condition under which
 *  the old createdAt ordering became ambiguous. */
function fakeTx(seed: StoredEntry[] = [], now = new Date('2026-08-08T10:00:00Z')) {
  const rows = [...seed]
  return {
    rows,
    auditEntry: {
      async findFirst({ where }: { where: { entityId: string } }) {
        const mine = rows.filter(r => r.entityId === where.entityId)
        if (mine.length === 0) return null
        const tail = [...mine].sort((a, b) => b.sequence - a.sequence)[0]
        return { hash: tail.hash, sequence: tail.sequence }
      },
      async create({ data }: { data: Omit<StoredEntry, 'createdAt' | 'payload'> & { payload: unknown } }) {
        if (rows.some(r => r.entityId === data.entityId && r.sequence === data.sequence)) {
          throw new Error('unique constraint violated: (entityId, sequence)')
        }
        const row = { ...data, payload: data.payload as AuditPayload, createdAt: now }
        rows.push(row)
        return row
      },
    },
  }
}

function payload(recordId: string): AuditPayload {
  return {
    recordId,
    entityId: 'e1',
    domain: 'ENERGY',
    fieldName: 'total_consumption_kwh',
    value: 100,
    unit: 'MJ',
    originalValue: 27.78,
    originalUnit: 'kWh',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-03-31T00:00:00.000Z',
    trustTier: 'A',
    confidenceScore: 1,
    sourceText: null,
    documentId: null,
    extractionMethod: 'MANUAL_ENTRY',
    submittedAt: '2026-08-08T10:00:00.000Z',
    submittedById: 'u1',
  }
}

const append = (tx: ReturnType<typeof fakeTx>, recordId: string) =>
  appendAuditEntry(tx, {
    entityId: 'e1',
    recordId,
    eventType: 'CREATED',
    payload: payload(recordId),
  })

describe('appendAuditEntry', () => {
  it('starts a chain at sequence 1 with no previous hash', async () => {
    const tx = fakeTx()
    const result = await append(tx, 'r1')
    expect(result.sequence).toBe(1)
    expect(result.previousHash).toBeNull()
  })

  it('numbers entries consecutively and links each to the one before', async () => {
    const tx = fakeTx()
    const first = await append(tx, 'r1')
    const second = await append(tx, 'r2')
    const third = await append(tx, 'r3')

    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3])
    expect(second.previousHash).toBe(first.hash)
    expect(third.previousHash).toBe(second.hash)
  })

  // The defect this exists to prevent: three entries written inside one
  // transaction share a createdAt, so ordering by it cannot say which is the tail.
  it('picks the tail by sequence even when every entry shares a timestamp', async () => {
    const tx = fakeTx()
    await append(tx, 'r1')
    await append(tx, 'r2')
    const third = await append(tx, 'r3')

    const timestamps = new Set(tx.rows.map(r => r.createdAt.toISOString()))
    expect(timestamps.size).toBe(1)

    const bySequence = [...tx.rows].sort((a, b) => a.sequence - b.sequence)
    expect(bySequence.at(-1)!.hash).toBe(third.hash)
    expect(verifyChain(bySequence)).toBe(true)
  })

  it('produces a chain that verifies when walked in sequence order', async () => {
    const tx = fakeTx()
    for (const id of ['r1', 'r2', 'r3', 'r4']) await append(tx, id)
    const ordered = [...tx.rows].sort((a, b) => a.sequence - b.sequence)
    expect(verifyChain(ordered)).toBe(true)
  })

  it('surfaces the collision when two appends claim the same position', async () => {
    const tx = fakeTx()
    await append(tx, 'r1')
    // Simulate the loser of a race: it read the same tail and computed sequence 2,
    // which the winner already took. The unique constraint must reject it rather
    // than let two entries share a position.
    const staleReader: AuditTxClient = {
      auditEntry: {
        findFirst: async () => null, // read a tail that is already out of date
        create: tx.auditEntry.create,
      },
    }
    await expect(
      appendAuditEntry(staleReader, {
        entityId: 'e1',
        recordId: 'r2',
        eventType: 'CREATED',
        payload: payload('r2'),
      }),
    ).rejects.toThrow(/unique constraint/)
  })

  it('keeps chains for different entities independent', async () => {
    const tx = fakeTx()
    await append(tx, 'r1')
    const other = await appendAuditEntry(tx, {
      entityId: 'e2',
      recordId: 'r9',
      eventType: 'CREATED',
      payload: { ...payload('r9'), entityId: 'e2' },
    })
    expect(other.sequence).toBe(1)
    expect(other.previousHash).toBeNull()
  })
})
