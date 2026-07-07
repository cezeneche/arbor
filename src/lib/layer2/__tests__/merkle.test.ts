import {
  hashLeaf,
  hashInternal,
  merkleRoot,
  buildInclusionProof,
  verifyInclusionProof,
} from '../merkle'

// Merkle-DAG audit structure.
//
// The linear HMAC chain proves tamper-evidence at write time; the Merkle tree
// is the additive commitment that makes single-record proofs shareable. Leaves
// are the existing per-record `auditHash` values. A record's proof of inclusion
// is a Merkle path of length ~log2(n) an auditor verifies offline against a
// published root — without seeing any other record.
//
// Implemented to RFC 6962 (Certificate Transparency): leaf = H(0x00 || data),
// node = H(0x01 || left || right), and an odd level splits at the largest power
// of two below n. The domain separation blocks passing an internal node off as
// a leaf; the split blocks the duplicate-node forgery. Correctness is pinned to
// RFC 6962's published test vectors.

describe('RFC 6962 conformance vectors', () => {
  it('empty tree hashes to SHA-256 of the empty string', () => {
    expect(merkleRoot([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('a single empty leaf hashes with the 0x00 domain prefix', () => {
    // RFC 6962 §2.1 published vector for H(0x00 || "").
    expect(hashLeaf('')).toBe(
      '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
    )
  })

  it('single-leaf root is just that leaf hash (no internal node)', () => {
    expect(merkleRoot(['deadbeef'])).toBe(hashLeaf('deadbeef'))
  })

  it('two-leaf root composes the two leaf hashes under the 0x01 prefix', () => {
    const root = merkleRoot(['a', 'b'])
    expect(root).toBe(hashInternal(hashLeaf('a'), hashLeaf('b')))
  })
})

describe('merkleRoot — determinism and tamper sensitivity', () => {
  const leaves = ['h0', 'h1', 'h2', 'h3', 'h4'] // 5 = odd, exercises the RFC split

  it('is order-sensitive: reordering leaves changes the root', () => {
    expect(merkleRoot(leaves)).not.toBe(merkleRoot([...leaves].reverse()))
  })

  it('changing any single leaf changes the root', () => {
    const tampered = [...leaves]
    tampered[2] = 'h2-tampered'
    expect(merkleRoot(tampered)).not.toBe(merkleRoot(leaves))
  })
})

describe('inclusion proofs', () => {
  const leaves = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] // 7 leaves, unbalanced

  it('every leaf produces a proof that verifies against the root', () => {
    const root = merkleRoot(leaves)
    for (let i = 0; i < leaves.length; i++) {
      const proof = buildInclusionProof(leaves, i)
      expect(proof.root).toBe(root)
      expect(proof.leaf).toBe(leaves[i])
      expect(proof.leafCount).toBe(leaves.length)
      // Path length is ~log2(n); an auditor recomputes the root from it alone.
      expect(verifyInclusionProof(proof)).toBe(true)
    }
  })

  it('rejects a proof whose leaf was swapped for another value', () => {
    const proof = buildInclusionProof(leaves, 3)
    expect(verifyInclusionProof({ ...proof, leaf: 'not-the-real-leaf' })).toBe(false)
  })

  it('rejects a proof whose claimed root was altered', () => {
    const proof = buildInclusionProof(leaves, 3)
    const badRoot = proof.root.replace(/^./, c => (c === 'a' ? 'b' : 'a'))
    expect(verifyInclusionProof({ ...proof, root: badRoot })).toBe(false)
  })

  it('rejects a proof with a tampered sibling in the path', () => {
    const proof = buildInclusionProof(leaves, 3)
    const path = proof.path.map((s, i) =>
      i === 0 ? { ...s, siblingHash: hashLeaf('forged') } : s,
    )
    expect(verifyInclusionProof({ ...proof, path })).toBe(false)
  })

  it('a single-leaf tree yields an empty path that still verifies', () => {
    const proof = buildInclusionProof(['only'], 0)
    expect(proof.path).toEqual([])
    expect(verifyInclusionProof(proof)).toBe(true)
  })

  it('throws when asked to prove an out-of-range leaf', () => {
    expect(() => buildInclusionProof(leaves, 99)).toThrow()
    expect(() => buildInclusionProof([], 0)).toThrow()
  })
})
