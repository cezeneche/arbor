// Pure rules for how a differentially-private release is reused. No DB, no
// network — the admin route wires this to Prisma.
//
// Differential privacy protects a release, not a series of them. Every call drew
// fresh Laplace noise over the same underlying values, so asking the endpoint
// enough times and averaging the answers converges on the true figure: the noise
// cancels and the guarantee is gone. That is not a theoretical concern — it is a
// GET an operator can loop.
//
// The fix is that identical data may only ever be released once. A release is
// keyed by the group, the epsilon, and a fingerprint of the exact values behind
// it; a repeat request with the same fingerprint returns the release already
// made, noise and all. Genuinely new data changes the fingerprint and earns a new
// release — which is also, correctly, a new draw against the privacy budget.
import { createHash } from 'crypto'
import type { DPGroupInput, DPRelease } from '@/lib/brain/types'

/** Identity of the data behind a group. Values are sorted so the fingerprint
 *  depends on the multiset, not the order rows happened to come back in, and
 *  rounded so floating-point noise in the inputs cannot mint a "new" release. */
export function fingerprintGroup(group: DPGroupInput): string {
  const canonical = JSON.stringify({
    values: [...group.values].map(v => Number(v.toFixed(6))).sort((a, b) => a - b),
    low: group.low,
    high: group.high,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export interface LedgerEntry {
  groupKey: string
  epsilon: number
  inputFingerprint: string
  suppressed: boolean
  n: number
  dpMean: number | null
  dpCount: number | null
}

export interface ReleasePlan {
  /** Groups with no prior release at this epsilon and fingerprint. */
  toRelease: DPGroupInput[]
  /** Releases replayed from the ledger, in the caller's group order. */
  replayed: DPRelease[]
  fingerprints: Map<string, string>
}

/** Splits the requested groups into "already released" and "needs a draw". */
export function planDpRelease(
  groups: DPGroupInput[],
  epsilon: number,
  ledger: LedgerEntry[],
): ReleasePlan {
  const fingerprints = new Map<string, string>()
  for (const g of groups) fingerprints.set(g.key, fingerprintGroup(g))

  const byKey = new Map<string, LedgerEntry>()
  for (const entry of ledger) {
    byKey.set(`${entry.groupKey}__${entry.epsilon}__${entry.inputFingerprint}`, entry)
  }

  const toRelease: DPGroupInput[] = []
  const replayed: DPRelease[] = []

  for (const g of groups) {
    const prior = byKey.get(`${g.key}__${epsilon}__${fingerprints.get(g.key)}`)
    if (prior) {
      replayed.push({
        key: prior.groupKey,
        suppressed: prior.suppressed,
        n: prior.n,
        dp_mean: prior.dpMean,
        dp_count: prior.dpCount,
        epsilon,
        reason: prior.suppressed ? 'below population floor' : null,
      })
    } else {
      toRelease.push(g)
    }
  }

  return { toRelease, replayed, fingerprints }
}

/** Merges replayed and freshly-drawn releases back into the caller's group order,
 *  so the response does not reveal which groups were new. */
export function mergeReleases(
  groups: DPGroupInput[],
  replayed: DPRelease[],
  fresh: DPRelease[],
): DPRelease[] {
  const byKey = new Map<string, DPRelease>()
  for (const r of [...replayed, ...fresh]) byKey.set(r.key, r)
  return groups.map(g => byKey.get(g.key)).filter((r): r is DPRelease => r !== undefined)
}
