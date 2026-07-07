// Layer 2 — Merkle-DAG audit structure. Pure cryptographic functions.
//
// The linear HMAC chain (audit-chain.ts) proves tamper-evidence at
// write time; this Merkle tree is the additive commitment that makes a single
// record's authenticity *shareable*. Leaves are the existing per-record
// `auditHash` values, in a fixed order. A single root commits the whole set; a
// record's proof of inclusion is a Merkle path of length ~log2(n) that an
// auditor recomputes into the root offline — without seeing any other record.
//
// Built to RFC 6962 (Certificate Transparency), the gold standard for tamper-
// evident logs:
//   - Domain separation: leaf = SHA256(0x00 || data), node = SHA256(0x01 || l || r).
//     Prevents presenting an internal node as a leaf (second-preimage forgery).
//   - Unbalanced levels split at the largest power of two below n, rather than
//     duplicating the last node — which closes the CVE-2012-2459 duplicate-node
//     forgery.
// Verification (`verifyInclusionProof`) depends on nothing but Node's crypto and
// the proof itself, so it ports trivially to a standalone offline verifier.
import { createHash } from 'crypto'

const LEAF_PREFIX = Buffer.from([0x00])
const NODE_PREFIX = Buffer.from([0x01])

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Leaf hash: SHA256(0x00 || data). `data` is hashed as UTF-8 bytes. */
export function hashLeaf(data: string): string {
  return sha256Hex(Buffer.concat([LEAF_PREFIX, Buffer.from(data, 'utf8')]))
}

/** Internal node hash: SHA256(0x01 || left || right), children given as hex. */
export function hashInternal(leftHex: string, rightHex: string): string {
  return sha256Hex(
    Buffer.concat([
      NODE_PREFIX,
      Buffer.from(leftHex, 'hex'),
      Buffer.from(rightHex, 'hex'),
    ]),
  )
}

/** Largest power of two strictly less than n (n > 1). RFC 6962's split point. */
function largestPowerOfTwoBelow(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

/** RFC 6962 Merkle Tree Hash over `leaves` (leaf data, in order). */
export function merkleRoot(leaves: string[]): string {
  const n = leaves.length
  if (n === 0) return sha256Hex(Buffer.alloc(0)) // MTH({}) = SHA256("")
  if (n === 1) return hashLeaf(leaves[0])
  const k = largestPowerOfTwoBelow(n)
  return hashInternal(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)))
}

export interface MerkleProofStep {
  /** Sibling subtree hash (hex). */
  siblingHash: string
  /** Which side the sibling sits on when combining with the running hash. */
  position: 'left' | 'right'
}

export interface MerkleInclusionProof {
  /** The original leaf data (e.g. a record's auditHash). */
  leaf: string
  leafIndex: number
  leafCount: number
  /** Bottom-up Merkle path: sibling hashes with their side. */
  path: MerkleProofStep[]
  /** The committed root this proof recomputes to (hex). */
  root: string
}

/** RFC 6962 audit path for leaf `index` within `leaves`. */
export function buildInclusionProof(leaves: string[], index: number): MerkleInclusionProof {
  if (leaves.length === 0) throw new Error('cannot prove inclusion in an empty tree')
  if (index < 0 || index >= leaves.length) {
    throw new Error(`leaf index ${index} out of range for ${leaves.length} leaves`)
  }

  const path: MerkleProofStep[] = []

  // Recurse toward the leaf first, then record the sibling subtree at each
  // split on the way back up — so the path comes out bottom-up (the deepest
  // sibling first), exactly the order verification consumes it.
  const walk = (subset: string[], m: number): void => {
    if (subset.length <= 1) return
    const k = largestPowerOfTwoBelow(subset.length)
    if (m < k) {
      // Target is in the left half; sibling is the right subtree.
      walk(subset.slice(0, k), m)
      path.push({ siblingHash: merkleRoot(subset.slice(k)), position: 'right' })
    } else {
      // Target is in the right half; sibling is the left subtree.
      walk(subset.slice(k), m - k)
      path.push({ siblingHash: merkleRoot(subset.slice(0, k)), position: 'left' })
    }
  }
  walk(leaves, index)

  return {
    leaf: leaves[index],
    leafIndex: index,
    leafCount: leaves.length,
    path,
    root: merkleRoot(leaves),
  }
}

/**
 * Recompute the root from the leaf and its path and compare to the committed
 * root. Offline, self-contained — the whole point of the Merkle proof.
 */
export function verifyInclusionProof(proof: MerkleInclusionProof): boolean {
  let node = hashLeaf(proof.leaf)
  for (const step of proof.path) {
    node =
      step.position === 'left'
        ? hashInternal(step.siblingHash, node)
        : hashInternal(node, step.siblingHash)
  }
  return node === proof.root
}
