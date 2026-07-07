// zero-knowledge predicate compliance, statement layer. Pure crypto.
//
// A ZK proof needs three things: a public commitment (the Merkle root), a
// public statement (which predicate, with what thresholds), and a
// private witness (the records). This module is the commitment/statement half —
// the part that is the same whatever proving system generates the proof. It
// defines the predicate templates the plan calls for (numeric inequality, set
// membership, weighted-sum threshold), evaluates them over records (the witness,
// used prover-side), and binds a predicate to a Merkle root as a single public
// statement digest that a proof attests to.
//
// The proof *generation* (Groth16 / Halo2) is a separate, heavier concern; this
// layer is what it proves against, and is fully testable on its own.
import { createHash } from 'crypto'

export type Predicate =
  // "Scope 1 < X": an aggregate of a numeric field compared to a threshold.
  | { kind: 'numeric_inequality'; field: string; aggregate: 'sum' | 'mean' | 'max'; op: '<' | '<=' | '>' | '>='; threshold: number }
  // "no sanctioned origin": no record's category falls in a forbidden set.
  | { kind: 'set_membership'; field: string; forbidden: string[] }
  // "renewable share > Y%": a ratio of two summed fields vs a threshold.
  | { kind: 'weighted_sum_threshold'; numeratorField: string; denominatorField: string; op: '<' | '<=' | '>' | '>='; threshold: number }

export interface EvalRecord {
  field: string
  value?: number
  category?: string
}

export interface PredicateResult {
  satisfied: boolean
  kind: Predicate['kind']
  /** The aggregate/ratio actually observed (null for set membership). */
  observed: number | null
  detail: string
}

function compare(observed: number, op: '<' | '<=' | '>' | '>=', threshold: number): boolean {
  switch (op) {
    case '<': return observed < threshold
    case '<=': return observed <= threshold
    case '>': return observed > threshold
    case '>=': return observed >= threshold
  }
}

function aggregate(values: number[], how: 'sum' | 'mean' | 'max'): number {
  if (values.length === 0) return 0
  if (how === 'sum') return values.reduce((s, v) => s + v, 0)
  if (how === 'max') return Math.max(...values)
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** Evaluate a predicate over the witness records (prover-side). */
export function evaluatePredicate(predicate: Predicate, records: EvalRecord[]): PredicateResult {
  if (predicate.kind === 'numeric_inequality') {
    const values = records.filter(r => r.field === predicate.field && typeof r.value === 'number').map(r => r.value as number)
    const observed = aggregate(values, predicate.aggregate)
    return {
      satisfied: compare(observed, predicate.op, predicate.threshold),
      kind: predicate.kind,
      observed,
      detail: `${predicate.aggregate}(${predicate.field}) = ${observed} ${predicate.op} ${predicate.threshold}`,
    }
  }

  if (predicate.kind === 'set_membership') {
    const forbidden = new Set(predicate.forbidden)
    const hit = records.find(r => r.field === predicate.field && r.category != null && forbidden.has(r.category))
    return {
      satisfied: !hit,
      kind: predicate.kind,
      observed: null,
      detail: hit ? `${predicate.field} contains forbidden "${hit.category}"` : `${predicate.field} avoids all forbidden values`,
    }
  }

  // weighted_sum_threshold
  const num = aggregate(records.filter(r => r.field === predicate.numeratorField && typeof r.value === 'number').map(r => r.value as number), 'sum')
  const den = aggregate(records.filter(r => r.field === predicate.denominatorField && typeof r.value === 'number').map(r => r.value as number), 'sum')
  const observed = den === 0 ? 0 : num / den
  return {
    satisfied: compare(observed, predicate.op, predicate.threshold),
    kind: predicate.kind,
    observed,
    detail: `${predicate.numeratorField}/${predicate.denominatorField} = ${observed} ${predicate.op} ${predicate.threshold}`,
  }
}

export interface PredicateStatement {
  /** The public commitment the predicate is proven against. */
  merkleRoot: string
  predicate: Predicate
}

/** Canonical, order-stable JSON so the digest is deterministic across callers. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The public statement digest a proof attests to: SHA-256 over the Merkle root
 * and the predicate. Anyone holding the same root + predicate recomputes the
 * same digest, so a proof bound to it is unambiguous.
 */
export function statementDigest(statement: PredicateStatement): string {
  return createHash('sha256').update(canonical(statement), 'utf8').digest('hex')
}
