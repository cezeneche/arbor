// Layer 2 — cryptographic signing for third-party verification (Gap 3) and
// audit-package integrity (Gap 4). Pure functions, no DB or AI. Same HMAC
// secret as the audit chain — it never leaves the server.
import { createHmac } from 'crypto'

function secret(): string {
  const s = process.env.AUDIT_CHAIN_SECRET
  if (!s) throw new Error('AUDIT_CHAIN_SECRET environment variable is not set')
  return s
}

export interface VerificationSignatureInput {
  entityId: string
  periodStart: string
  periodEnd: string
  verifierId: string
  verifiedAt: string
}

// The signed verification artefact recorded when a verifier marks an assignment VERIFIED.
export function computeVerificationSignature(input: VerificationSignatureInput): string {
  const payload = `${input.entityId}|${input.periodStart}|${input.periodEnd}|${input.verifierId}|${input.verifiedAt}`
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

// Stable hash of an audit package's contents. Keys are sorted recursively so the
// hash does not depend on serialisation order. Used for public verification (Gap 4).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function computePackageHash(packageContents: unknown): string {
  return createHmac('sha256', secret()).update(stableStringify(packageContents)).digest('hex')
}
