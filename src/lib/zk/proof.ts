// the proving-engine interface. Deliberately engine-agnostic.
//
// The statement layer (predicate.ts) defines *what* is proven and against which
// commitment. This defines the shape of a proof and the prove/verify contract a
// real engine (Groth16 via Circom + snarkjs, or Halo2) will implement. The
// engine itself is a deferred, separately-verifiable build — a trusted-setup
// ceremony and circuit compilation can't be responsibly stood up in-line — so
// until it lands, PendingProofSystem reports unavailability honestly rather than
// emitting a proof that isn't zero-knowledge.

import type { PredicateStatement, EvalRecord } from './predicate'

export interface ZkProof {
  /** The proving system that produced this, e.g. "groth16". */
  system: string
  /** The public statement digest this proof attests to (statementDigest). */
  statementDigest: string
  /** Opaque serialized proof, verifier-checkable without the witness. */
  proof: string
  /** Public signals exposed by the circuit (e.g. the threshold, the root). */
  publicSignals: string[]
}

export interface ProofSystem {
  readonly name: string
  /** False until a real engine is wired; callers must check before proving. */
  readonly available: boolean
  prove(statement: PredicateStatement, witness: EvalRecord[]): Promise<ZkProof>
  verify(statement: PredicateStatement, proof: ZkProof): Promise<boolean>
}

export const PENDING_ENGINE = 'engine-pending'

/** Placeholder until the Groth16/Halo2 engine is built. Never fakes a proof. */
export class PendingProofSystem implements ProofSystem {
  readonly name = PENDING_ENGINE
  readonly available = false

  async prove(): Promise<ZkProof> {
    throw new Error('ZK proving engine not yet available — statement layer only')
  }

  async verify(): Promise<boolean> {
    throw new Error('ZK proving engine not yet available — statement layer only')
  }
}
