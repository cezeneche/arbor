// Layer 2 — the HMAC chain that makes a Verified record mean anything.
//
// This module had no tests, and shipped a chain that could never be verified.
// The hash was taken over `JSON.stringify(payload)`, which serialises keys in
// insertion order. The payload column is `Json`, which Prisma maps to `jsonb`,
// and jsonb does not preserve key order — it stores keys shortest-first, then
// bytewise. So a payload written in declared order came back in a different
// order, re-serialised to a different string, and hashed to a different value.
// Every entity failed verification, on every deployment.
//
// The order below is not invented: it is the order the payload actually comes
// back in from Postgres, copied from a live row.

process.env.AUDIT_CHAIN_SECRET = 'test-secret-for-audit-chain'

import { computeRecordHash, verifyChain, type AuditPayload } from '../audit-chain'

const payload = (over: Partial<AuditPayload> = {}): AuditPayload => ({
  recordId: 'rec_1',
  entityId: 'ent_1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 1284500,
  unit: 'mj',
  originalValue: 356805.55,
  originalUnit: 'kwh',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-03-31T00:00:00.000Z',
  trustTier: 'A',
  confidenceScore: 0.97,
  sourceText: 'Total consumption 356,805.55 kWh',
  documentId: 'doc_1',
  extractionMethod: 'DOCUMENT_AI',
  submittedAt: '2026-04-02T09:15:00.000Z',
  submittedById: 'usr_1',
  ...over,
})

/** How Postgres hands the payload back: shortest key first, then bytewise. */
function asReadBackFromJsonb(p: AuditPayload): AuditPayload {
  const order = [
    'unit', 'value', 'domain', 'entityId', 'recordId', 'fieldName', 'periodEnd',
    'trustTier', 'documentId', 'sourceText', 'periodStart', 'submittedAt',
    'originalUnit', 'originalValue', 'submittedById', 'confidenceScore',
    'extractionMethod',
  ] as const
  const out: Record<string, unknown> = {}
  for (const key of order) out[key] = p[key as keyof AuditPayload]
  return out as unknown as AuditPayload
}

describe('computeRecordHash', () => {
  it('is stable for the same payload and predecessor', () => {
    expect(computeRecordHash(payload(), 'prev')).toBe(computeRecordHash(payload(), 'prev'))
  })

  it('survives the round trip through jsonb', () => {
    // The whole bug, in one assertion. Same payload, different key order,
    // because that is what the database returns.
    const written = computeRecordHash(payload(), 'prev')
    const readBack = computeRecordHash(asReadBackFromJsonb(payload()), 'prev')
    expect(readBack).toBe(written)
  })

  it('does not depend on key order at all', () => {
    const reversed = Object.fromEntries(
      Object.entries(payload()).reverse(),
    ) as unknown as AuditPayload
    expect(computeRecordHash(reversed, 'prev')).toBe(computeRecordHash(payload(), 'prev'))
  })

  it('still changes when any value changes', () => {
    // Order-independence must not cost tamper evidence.
    const base = computeRecordHash(payload(), 'prev')
    expect(computeRecordHash(payload({ value: 1284501 }), 'prev')).not.toBe(base)
    expect(computeRecordHash(payload({ trustTier: 'B' }), 'prev')).not.toBe(base)
    expect(computeRecordHash(payload({ sourceText: 'something else' }), 'prev')).not.toBe(base)
    expect(computeRecordHash(payload({ submittedById: 'usr_2' }), 'prev')).not.toBe(base)
  })

  it('still changes when the predecessor changes', () => {
    expect(computeRecordHash(payload(), 'a')).not.toBe(computeRecordHash(payload(), 'b'))
  })

  it('treats the first record in a chain as following GENESIS', () => {
    expect(computeRecordHash(payload(), null)).toBe(computeRecordHash(payload(), 'GENESIS'))
  })

  it('refuses to hash without a secret', () => {
    const secret = process.env.AUDIT_CHAIN_SECRET
    delete process.env.AUDIT_CHAIN_SECRET
    expect(() => computeRecordHash(payload(), null)).toThrow(/AUDIT_CHAIN_SECRET/)
    process.env.AUDIT_CHAIN_SECRET = secret
  })
})

describe('verifyChain', () => {
  function chainOf(payloads: AuditPayload[]) {
    let previousHash: string | null = null
    return payloads.map(p => {
      const hash = computeRecordHash(p, previousHash)
      const entry = { hash, previousHash, payload: p }
      previousHash = hash
      return entry
    })
  }

  it('accepts a well-formed chain', () => {
    expect(verifyChain(chainOf([payload({ recordId: 'a' }), payload({ recordId: 'b' })]))).toBe(true)
  })

  it('accepts a chain whose payloads came back from jsonb reordered', () => {
    // This is the case that matters: entries written months ago, read back now.
    const chain = chainOf([payload({ recordId: 'a' }), payload({ recordId: 'b' })])
    const asStored = chain.map(e => ({ ...e, payload: asReadBackFromJsonb(e.payload) }))
    expect(verifyChain(asStored)).toBe(true)
  })

  it('rejects an altered value', () => {
    const chain = chainOf([payload({ recordId: 'a' }), payload({ recordId: 'b' })])
    chain[1].payload = payload({ recordId: 'b', value: 999 })
    expect(verifyChain(chain)).toBe(false)
  })

  it('rejects a broken link even when every hash is individually valid', () => {
    const chain = chainOf([payload({ recordId: 'a' }), payload({ recordId: 'b' })])
    const orphan = { ...chain[1], previousHash: 'not-the-previous-hash' }
    orphan.hash = computeRecordHash(orphan.payload, orphan.previousHash)
    expect(verifyChain([chain[0], orphan])).toBe(false)
  })

  it('accepts an empty chain', () => {
    expect(verifyChain([])).toBe(true)
  })
})
