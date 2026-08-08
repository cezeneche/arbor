// Layer 2  -  Audit Chain. Pure cryptographic functions.
// HMAC-SHA256 chain links each record to the previous one, ensuring tamper-evidence.
import { createHmac } from 'crypto'

export interface AuditPayload {
  recordId: string
  entityId: string
  domain: string
  fieldName: string
  value: number
  unit: string
  originalValue: number
  originalUnit: string
  periodStart: string
  periodEnd: string
  trustTier: string
  confidenceScore: number
  sourceText: string | null
  documentId: string | null
  extractionMethod: string
  submittedAt: string
  submittedById: string
}

/**
 * The exact bytes that get hashed.
 *
 * `JSON.stringify` serialises keys in insertion order, and the payload is stored
 * in a `Json` column, which Prisma maps to `jsonb` — and jsonb does not preserve
 * key order. So a payload written in declared order came back shortest-key-first
 * and hashed to something else entirely: every chain failed verification, on
 * every deployment, from the first record onwards.
 *
 * Rebuilding the object field by field makes the serialisation depend on this
 * schema rather than on however the object happened to arrive. The order below
 * is the declared order of AuditPayload, which is also the order every writer
 * constructs it in — so hashes written before this fix verify unchanged. Nothing
 * is re-hashed; re-hashing would recompute over whatever is in the table today,
 * which is exactly the tamper evidence the chain exists to provide.
 *
 * Adding a field to AuditPayload means adding it here, and that changes every
 * hash from that point on. `audit-chain.test.ts` pins the behaviour.
 */
function canonicalise(payload: AuditPayload, previousHash: string | null) {
  return {
    recordId: payload.recordId,
    entityId: payload.entityId,
    domain: payload.domain,
    fieldName: payload.fieldName,
    value: payload.value,
    unit: payload.unit,
    originalValue: payload.originalValue,
    originalUnit: payload.originalUnit,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    trustTier: payload.trustTier,
    confidenceScore: payload.confidenceScore,
    sourceText: payload.sourceText,
    documentId: payload.documentId,
    extractionMethod: payload.extractionMethod,
    submittedAt: payload.submittedAt,
    submittedById: payload.submittedById,
    previousHash: previousHash ?? 'GENESIS',
  }
}

export function computeRecordHash(payload: AuditPayload, previousHash: string | null): string {
  const secret = process.env.AUDIT_CHAIN_SECRET
  if (!secret) throw new Error('AUDIT_CHAIN_SECRET environment variable is not set')

  return createHmac('sha256', secret)
    .update(JSON.stringify(canonicalise(payload, previousHash)))
    .digest('hex')
}

export function verifyChain(
  entries: Array<{ hash: string; previousHash: string | null; payload: AuditPayload }>,
): boolean {
  for (let i = 0; i < entries.length; i++) {
    const expected = computeRecordHash(entries[i].payload, entries[i].previousHash)
    if (expected !== entries[i].hash) return false
    if (i > 0 && entries[i].previousHash !== entries[i - 1].hash) return false
  }
  return true
}
