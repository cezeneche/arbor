import {
  requestDigest,
  reserveIngestOperation,
  claimItem,
  completeIngestOperation,
  releaseIngestOperation,
  STALE_MS,
} from '../ingest-operation'

// An idempotency key has to hold under the failures it exists for: a retry after
// a crash half-way through a batch, two copies of one request in flight at once,
// and a replay after the entity's plan has since filled up. The reservation is
// made before any record is written, and each item's outcome is committed in the
// same transaction as its record — so a retry can tell exactly what landed.

type Op = {
  id: string
  entityId: string
  idempotencyKey: string
  requestDigest: string
  status: 'IN_PROGRESS' | 'PARTIAL' | 'COMPLETE'
  results: Record<string, unknown>
  updatedAt: Date
}

function uniqueViolation() {
  const e = new Error('Unique constraint failed') as Error & { code: string }
  e.code = 'P2002'
  return e
}

function fakeDb(seed: Op[] = []) {
  const ops = new Map(seed.map(o => [`${o.entityId}:${o.idempotencyKey}`, o]))
  const byId = () => new Map([...ops.values()].map(o => [o.id, o]))
  return {
    ops,
    ingestOperation: {
      create: jest.fn(async ({ data }: { data: Omit<Op, 'id' | 'updatedAt' | 'results' | 'status'> }) => {
        const key = `${data.entityId}:${data.idempotencyKey}`
        if (ops.has(key)) throw uniqueViolation()
        const op: Op = { ...data, id: `op-${ops.size + 1}`, status: 'IN_PROGRESS', results: {}, updatedAt: new Date() }
        ops.set(key, op)
        return op
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return byId().get(where.id) ?? null
        const k = where.entityId_idempotencyKey
        return ops.get(`${k.entityId}:${k.idempotencyKey}`) ?? null
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const op = byId().get(where.id)
        if (!op) return { count: 0 }
        if (where.OR) {
          const ok = where.OR.some((c: any) =>
            c.status === op.status && (!c.updatedAt || op.updatedAt < c.updatedAt.lt),
          )
          if (!ok) return { count: 0 }
        }
        Object.assign(op, data, { updatedAt: new Date() })
        return { count: 1 }
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const op = byId().get(where.id)!
        Object.assign(op, data, { updatedAt: new Date() })
        return op
      }),
    },
  }
}

const RECORDS = [{ fieldName: 'a', value: 1 }, { fieldName: 'b', value: 2 }]

describe('requestDigest', () => {
  it('is the same for the same request and different for a different one', () => {
    expect(requestDigest(RECORDS)).toBe(requestDigest(JSON.parse(JSON.stringify(RECORDS))))
    expect(requestDigest(RECORDS)).not.toBe(requestDigest([{ fieldName: 'a', value: 9 }]))
  })
})

describe('reserveIngestOperation', () => {
  it('reserves a new key', async () => {
    const db = fakeDb()
    const out = await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')
    expect(out).toMatchObject({ kind: 'new', done: {} })
    expect(db.ops.size).toBe(1)
  })

  it('replays a completed batch with its original per-item results', async () => {
    const results = { '0': { index: 0, status: 'created', recordId: 'r1' } }
    const db = fakeDb([
      { id: 'op-1', entityId: 'ent-1', idempotencyKey: 'key-1', requestDigest: 'd1', status: 'COMPLETE', results, updatedAt: new Date() },
    ])
    expect(await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')).toEqual({
      kind: 'replay',
      results,
    })
  })

  it('refuses the same key sent with a different request', async () => {
    const db = fakeDb([
      { id: 'op-1', entityId: 'ent-1', idempotencyKey: 'key-1', requestDigest: 'd1', status: 'COMPLETE', results: {}, updatedAt: new Date() },
    ])
    expect(await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'OTHER')).toEqual({ kind: 'conflict' })
  })

  it('tells a concurrent copy of the request that the batch is in progress', async () => {
    const db = fakeDb()
    await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')
    expect(await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')).toEqual({ kind: 'in_progress' })
  })

  it('resumes a batch abandoned mid-way, with the items that already landed', async () => {
    const done = { '0': { index: 0, status: 'created', recordId: 'r1' } }
    const db = fakeDb([
      {
        id: 'op-1', entityId: 'ent-1', idempotencyKey: 'key-1', requestDigest: 'd1', status: 'IN_PROGRESS',
        results: done, updatedAt: new Date(Date.now() - STALE_MS - 1000),
      },
    ])
    expect(await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')).toEqual({
      kind: 'resume',
      id: 'op-1',
      done,
    })
  })

  it('keys are per entity: another entity may use the same key', async () => {
    const db = fakeDb()
    await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')
    expect((await reserveIngestOperation(db as never, 'ent-2', 'key-1', 'd1')).kind).toBe('new')
  })
})

describe('claimItem', () => {
  it('records an item outcome, and reports an item that already landed', async () => {
    const db = fakeDb()
    const op = await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')
    const id = (op as { id: string }).id

    const first = await claimItem(db as never, id, 0, { index: 0, status: 'created', recordId: 'r1' })
    expect(first).toEqual({ alreadyDone: false })

    const again = await claimItem(db as never, id, 0, { index: 0, status: 'created', recordId: 'r2' })
    expect(again).toEqual({ alreadyDone: true, result: { index: 0, status: 'created', recordId: 'r1' } })
  })
})

describe('completeIngestOperation', () => {
  it('marks the batch complete with its results, so later calls replay them', async () => {
    const db = fakeDb()
    const op = (await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')) as { id: string }
    await completeIngestOperation(db as never, op.id, { '0': { index: 0, status: 'created' } })
    expect((await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')).kind).toBe('replay')
  })
})

describe('releaseIngestOperation', () => {
  // A transient failure — a dropped connection, a full plan — is not an answer
  // to replay forever. The batch is released with its landed items kept, and the
  // next call with the key finishes it straight away.
  it('lets the next call resume at once, keeping what already landed', async () => {
    const db = fakeDb()
    const op = (await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')) as { id: string }
    await claimItem(db as never, op.id, 0, { index: 0, status: 'created', recordId: 'r1' })
    await releaseIngestOperation(db as never, op.id)

    const next = await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')
    expect(next).toEqual({
      kind: 'resume',
      id: op.id,
      done: { '0': { index: 0, status: 'created', recordId: 'r1' } },
    })
  })

  it('lets only one of two callers resume a released batch', async () => {
    const db = fakeDb()
    const op = (await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')) as { id: string }
    await releaseIngestOperation(db as never, op.id)
    expect((await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')).kind).toBe('resume')
    expect((await reserveIngestOperation(db as never, 'ent-1', 'key-1', 'd1')).kind).toBe('in_progress')
  })
})
