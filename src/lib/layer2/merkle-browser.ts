// Merkle inclusion verification using the Web Crypto API only.
//
// A deliberate sibling to merkle.ts: that module uses Node's `crypto` (server
// side); this one uses `globalThis.crypto.subtle` so it runs in a browser with
// no bundler shims and no Node built-ins. It is what powers the standalone
// verifier page, where an external auditor recomputes a record's root offline —
// the whole point of the Merkle proof. Both implementations are RFC 6962:
//   leaf = SHA256(0x00 || data),  node = SHA256(0x01 || left || right).
// The test suite cross-checks them so they can never diverge.

import type { MerkleInclusionProof } from './merkle'

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string must have even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('invalid hex string')
    out[i] = byte
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the exact byte range is hashed regardless
  // of the view's offset — subtle.digest hashes the whole underlying buffer.
  const buf = bytes.slice().buffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return bytesToHex(new Uint8Array(digest))
}

const LEAF_PREFIX = new Uint8Array([0x00])
const NODE_PREFIX = new Uint8Array([0x01])

/** Leaf hash: SHA256(0x00 || utf8(data)). */
async function hashLeaf(data: string): Promise<string> {
  return sha256Hex(concat(LEAF_PREFIX, new TextEncoder().encode(data)))
}

/** Internal node hash: SHA256(0x01 || left || right), children given as hex. */
async function hashInternal(leftHex: string, rightHex: string): Promise<string> {
  return sha256Hex(concat(NODE_PREFIX, concat(hexToBytes(leftHex), hexToBytes(rightHex))))
}

/**
 * Recompute the root from the leaf and its bottom-up path and compare to the
 * committed root. Async because Web Crypto's digest is Promise-based. Returns
 * false on any malformed input rather than throwing, so the UI can treat an
 * unverifiable proof the same as a failed one.
 */
export async function verifyInclusionProofWebCrypto(
  proof: MerkleInclusionProof,
): Promise<boolean> {
  try {
    let node = await hashLeaf(proof.leaf)
    for (const step of proof.path) {
      node =
        step.position === 'left'
          ? await hashInternal(step.siblingHash, node)
          : await hashInternal(node, step.siblingHash)
    }
    return node === proof.root
  } catch {
    return false
  }
}
