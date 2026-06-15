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

export function computeRecordHash(payload: AuditPayload, previousHash: string | null): string {
  const secret = process.env.AUDIT_CHAIN_SECRET
  if (!secret) throw new Error('AUDIT_CHAIN_SECRET environment variable is not set')

  const input = JSON.stringify({ ...payload, previousHash: previousHash ?? 'GENESIS' })
  return createHmac('sha256', secret).update(input).digest('hex')
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
