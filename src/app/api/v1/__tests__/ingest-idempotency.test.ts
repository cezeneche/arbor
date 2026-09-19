/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
/**
 * POST /api/v1/ingest under the failures an idempotency key exists for.
 *
 * The route is exercised against an in-memory store that behaves like the real
 * one where it matters: a unique (entityId, idempotencyKey) reservation, and a
 * transaction that commits the record and its item outcome together.
 */

const store = {
  ops: new Map<string, any>(),
  records: [] as any[],
  capacityAllowed: true,
  crashAfter: -1,
}

jest.mock('@/lib/api-key-auth', () => ({
  authenticateApiKeyRequest: jest.fn(async () => ({ authorized: true, scope: 'READ_WRITE', entityId: 'ent-1' })),
}))

jest.mock('@/lib/plan-guard', () => ({
  assertRecordCapacity: jest.fn(async () =>
    store.capacityAllowed ? { allowed: true } : { allowed: false, reason: 'Your plan is full' },
  ),
}))

jest.mock('@/lib/layer2/system-actor', () => ({ getSystemUser: jest.fn(async () => ({ id: 'system' })) }))

jest.mock('@/lib/layer2/record-writer', () => ({
  writeRecordWithAuditEntry: jest.fn(async (tx: any, input: any) => {
    tx.pendingRecords.push(input)
    if (store.records.length + tx.pendingRecords.length - 1 === store.crashAfter) {
      throw new Error('process died')
    }
    return { recordId: `rec-${store.records.length + tx.pendingRecords.length}`, hash: 'h' }
  }),
}))

function opsClient(target: Map<string, any>) {
  const byId = (id: string) => [...target.values()].find(o => o.id === id)
  return {
    create: async ({ data }: any) => {
      const key = `${data.entityId}:${data.idempotencyKey}`
      if (target.has(key)) throw Object.assign(new Error('unique'), { code: 'P2002' })
      const op = { ...data, id: `op-${target.size + 1}`, status: 'IN_PROGRESS', results: {}, updatedAt: new Date() }
      target.set(key, op)
      return op
    },
    findUnique: async ({ where }: any) =>
      where.id ? byId(where.id) ?? null : target.get(`${where.entityId_idempotencyKey.entityId}:${where.entityId_idempotencyKey.idempotencyKey}`) ?? null,
    update: async ({ where, data }: any) => Object.assign(byId(where.id), data, { updatedAt: new Date() }),
    updateMany: async ({ where, data }: any) => {
      const op = byId(where.id)
      const ok = op && where.OR.some((c: any) => c.status === op.status && (!c.updatedAt || op.updatedAt < c.updatedAt.lt))
      if (!ok) return { count: 0 }
      Object.assign(op, data, { updatedAt: new Date() })
      return { count: 1 }
    },
  }
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    get ingestOperation() {
      return opsClient(store.ops)
    },
    auditEntry: { findFirst: jest.fn(async () => null) },
    entity: { findUnique: jest.fn(async () => ({ id: 'ent-1' })) },
  },
}))

// A transaction commits its records and op updates together, or neither.
jest.mock('@/lib/layer2/serializable', () => ({
  runSerializable: async (fn: any) => {
    const staged = new Map([...store.ops].map(([k, v]) => [k, { ...v, results: { ...v.results } }]))
    const tx = { pendingRecords: [] as any[], ingestOperation: opsClient(staged) }
    const out = await fn(tx)
    store.records.push(...tx.pendingRecords)
    for (const [k, v] of staged) store.ops.set(k, v)
    return out
  },
}))

import { POST } from '../ingest/route'

const record = (i: number) => ({
  domain: 'ENERGY',
  fieldName: `field_${i}`,
  value: i + 1,
  unit: 'kwh',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-04-01T00:00:00.000Z',
})
const batch = (key?: string, n = 3) => ({ records: Array.from({ length: n }, (_, i) => record(i)), ...(key ? { idempotencyKey: key } : {}) })
const call = (body: unknown) =>
  POST(new Request('http://arbor.test/api/v1/ingest', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  store.ops.clear()
  store.records.length = 0
  store.capacityAllowed = true
  store.crashAfter = -1
})

describe('POST /api/v1/ingest with an idempotency key', () => {
  it('writes the batch once and replays the same per-item response on retry', async () => {
    const first = await call(batch('k1'))
    expect(first.status).toBe(201)
    const firstBody = await first.json()

    const again = await call(batch('k1'))
    expect(again.status).toBe(200)
    const againBody = await again.json()

    expect(store.records).toHaveLength(3)
    expect(againBody.idempotent).toBe(true)
    expect(againBody.results).toEqual(firstBody.results)
  })

  // Audit P1 #6: a crash between the records and the marker duplicated them all.
  it('resumes a batch whose write failed half-way without duplicating what landed', async () => {
    store.crashAfter = 1 // the second record's transaction fails
    const first = await (await call(batch('k2'))).json()
    expect(store.records).toHaveLength(1)
    expect(first.results[1]).toMatchObject({ status: 'rejected', retryable: true })

    store.crashAfter = -1
    const retry = await call(batch('k2'))
    const body = await retry.json()

    expect(store.records.map(r => r.fieldName)).toEqual(['field_0', 'field_1', 'field_2'])
    expect(body.results.map((r: any) => r.status)).toEqual(['created', 'created', 'created'])
  })

  it('tells a concurrent copy of the request that the batch is still in progress', async () => {
    store.ops.set('ent-1:k3', {
      id: 'op-x', entityId: 'ent-1', idempotencyKey: 'k3', requestDigest: 'irrelevant',
      status: 'IN_PROGRESS', results: {}, updatedAt: new Date(),
    })
    // Same digest as the incoming request, so it is the same request in flight.
    const { requestDigest } = jest.requireActual('@/lib/layer2/ingest-operation')
    store.ops.get('ent-1:k3').requestDigest = requestDigest(batch('k3').records)

    const res = await call(batch('k3'))
    expect(res.status).toBe(409)
    expect(store.records).toHaveLength(0)
  })

  it('refuses the same key reused for a different request', async () => {
    await call(batch('k4', 2))
    const res = await call(batch('k4', 3))
    expect(res.status).toBe(422)
    expect(store.records).toHaveLength(2)
  })

  it('replays a completed batch even when the plan has since filled up', async () => {
    await call(batch('k5'))
    store.capacityAllowed = false
    const res = await call(batch('k5'))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/ingest after a request died without answering', () => {
  it('lets a retry take over once the abandoned attempt is stale', async () => {
    const { requestDigest } = jest.requireActual('@/lib/layer2/ingest-operation')
    store.ops.set('ent-1:k6', {
      id: 'op-dead', entityId: 'ent-1', idempotencyKey: 'k6', requestDigest: requestDigest(batch('k6').records),
      status: 'IN_PROGRESS', results: { '0': { index: 0, status: 'created', recordId: 'rec-0' } },
      updatedAt: new Date(0),
    })
    const res = await call(batch('k6'))
    expect(res.status).toBe(201)
    // Item 0 landed before the process died; only 1 and 2 are written now.
    expect(store.records.map(r => r.fieldName)).toEqual(['field_1', 'field_2'])
  })
})
