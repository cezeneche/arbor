import { merkleRoot, buildInclusionProof } from '../merkle'
import { verifyInclusionProofWebCrypto } from '../merkle-browser'

// Upgrade 7 — the browser verifier an auditor runs offline. It must agree, bit
// for bit, with the Node RFC 6962 implementation: a proof built server-side has
// to verify in the browser, and a forged one must not. We cross-check the two
// implementations here so they can never silently diverge.

const leaves = ['a', 'b', 'c', 'd', 'e']

describe('verifyInclusionProofWebCrypto', () => {
  it('recomputes the Node-built root for every leaf', async () => {
    const root = merkleRoot(leaves)
    for (let i = 0; i < leaves.length; i++) {
      const proof = buildInclusionProof(leaves, i)
      expect(proof.root).toBe(root)
      await expect(verifyInclusionProofWebCrypto(proof)).resolves.toBe(true)
    }
  })

  it('verifies a single-leaf tree', async () => {
    const proof = buildInclusionProof(['solo'], 0)
    await expect(verifyInclusionProofWebCrypto(proof)).resolves.toBe(true)
  })

  it('rejects a tampered leaf', async () => {
    const proof = buildInclusionProof(leaves, 2)
    await expect(
      verifyInclusionProofWebCrypto({ ...proof, leaf: 'tampered' }),
    ).resolves.toBe(false)
  })

  it('rejects a proof whose committed root has been swapped', async () => {
    const proof = buildInclusionProof(leaves, 1)
    await expect(
      verifyInclusionProofWebCrypto({ ...proof, root: '00'.repeat(32) }),
    ).resolves.toBe(false)
  })

  it('rejects a tampered sibling hash in the path', async () => {
    const proof = buildInclusionProof(leaves, 3)
    const path = proof.path.map((s, i) =>
      i === 0 ? { ...s, siblingHash: 'ff'.repeat(32) } : s,
    )
    await expect(verifyInclusionProofWebCrypto({ ...proof, path })).resolves.toBe(false)
  })
})
