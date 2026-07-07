'use client'

import { useState } from 'react'
import { colours, typography, spacing, borders } from '@/lib/design-system'
import { verifyInclusionProofWebCrypto } from '@/lib/layer2/merkle-browser'
import type { MerkleInclusionProof } from '@/lib/layer2/merkle'

// standalone, offline Merkle inclusion verifier. An external auditor
// pastes the inclusion proof from an Arbor audit package and this page
// recomputes the record's root in their own browser, using nothing but the Web
// Crypto API. No data is fetched and nothing is sent anywhere — the proof is
// self-contained by design. Buyer/auditor-facing, so full technical detail is
// shown.

type Result =
  | { state: 'idle' }
  | { state: 'error'; message: string }
  | { state: 'verified'; proof: MerkleInclusionProof }
  | { state: 'failed'; proof: MerkleInclusionProof }

/** Accept either a bare MerkleInclusionProof or the package's { recordId, proof } wrapper. */
function extractProof(raw: unknown): MerkleInclusionProof {
  const obj = raw as Record<string, unknown>
  const candidate = (obj && typeof obj === 'object' && 'proof' in obj ? obj.proof : obj) as
    | MerkleInclusionProof
    | undefined
  if (
    !candidate ||
    typeof candidate.leaf !== 'string' ||
    typeof candidate.root !== 'string' ||
    !Array.isArray(candidate.path)
  ) {
    throw new Error('Not a Merkle inclusion proof — expected leaf, root and path fields.')
  }
  return candidate
}

const pageStyle: React.CSSProperties = {
  maxWidth: '760px',
  margin: '0 auto',
  padding: `${spacing[8]} ${spacing[4]}`,
  fontFamily: typography.fontFamily,
  color: colours.textPrimary,
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '220px',
  padding: '12px 14px',
  fontSize: typography.sizes.sm,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  backgroundColor: colours.surface,
  border: `1px solid ${colours.border}`,
  borderRadius: borders.radius.sm,
  outline: 'none',
  boxSizing: 'border-box',
  resize: 'vertical',
}

const buttonStyle: React.CSSProperties = {
  marginTop: spacing[3],
  padding: '12px 28px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  letterSpacing: typography.tracking.wide,
  textTransform: 'uppercase',
  color: colours.surface,
  backgroundColor: colours.navy,
  border: 'none',
  borderRadius: borders.radius.sm,
  cursor: 'pointer',
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: spacing[2], marginTop: '6px' }}>
      <span
        style={{
          minWidth: '120px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: colours.textSecondary,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: colours.textPrimary,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export default function VerifyMerklePage() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<Result>({ state: 'idle' })
  const [checking, setChecking] = useState(false)

  async function handleVerify() {
    setChecking(true)
    setResult({ state: 'idle' })
    try {
      const proof = extractProof(JSON.parse(input))
      const ok = await verifyInclusionProofWebCrypto(proof)
      setResult({ state: ok ? 'verified' : 'failed', proof })
    } catch (e) {
      setResult({
        state: 'error',
        message: e instanceof Error ? e.message : 'Could not read that proof.',
      })
    }
    setChecking(false)
  }

  return (
    <main style={pageStyle}>
      <p
        style={{
          fontSize: typography.sizes.label,
          fontWeight: typography.weights.medium,
          letterSpacing: typography.tracking.wider,
          textTransform: 'uppercase',
          color: colours.textTertiary,
          marginBottom: spacing[2],
        }}
      >
        Independent verification
      </p>
      <h1
        style={{
          fontSize: typography.sizes.lg,
          fontWeight: typography.weights.medium,
          letterSpacing: typography.tracking.heading,
          margin: 0,
        }}
      >
        Verify a record&rsquo;s inclusion proof
      </h1>
      <p
        style={{
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.light,
          lineHeight: typography.lineHeight.body,
          color: colours.textSecondary,
          marginTop: spacing[2],
        }}
      >
        Paste the inclusion proof from an Arbor audit package below. This page
        recomputes the record&rsquo;s Merkle root entirely in your browser and
        checks it against the committed root. Nothing is uploaded — the proof is
        self-contained, so the check works offline.
      </p>

      <textarea
        style={textareaStyle}
        placeholder='{ "leaf": "…", "leafIndex": 0, "leafCount": 12, "path": [ … ], "root": "…" }'
        value={input}
        onChange={e => setInput(e.target.value)}
        spellCheck={false}
      />

      <button
        style={{ ...buttonStyle, opacity: checking || !input.trim() ? 0.6 : 1 }}
        onClick={handleVerify}
        disabled={checking || !input.trim()}
      >
        {checking ? 'Verifying…' : 'Verify proof'}
      </button>

      {result.state !== 'idle' && (
        <section
          style={{
            marginTop: spacing[4],
            padding: spacing[3],
            borderRadius: borders.radius.md,
            border: `1px solid ${
              result.state === 'verified'
                ? colours.green
                : result.state === 'failed'
                  ? colours.red
                  : colours.border
            }`,
            backgroundColor:
              result.state === 'verified'
                ? colours.greenBg
                : result.state === 'failed'
                  ? colours.redBg
                  : colours.surface,
          }}
        >
          {result.state === 'error' ? (
            <p
              style={{
                margin: 0,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
              }}
            >
              {result.message}
            </p>
          ) : (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.medium,
                  color: result.state === 'verified' ? colours.green : colours.red,
                }}
              >
                {result.state === 'verified'
                  ? 'Verified — this record is included in the committed root.'
                  : 'Not verified — the proof does not recompute to its committed root.'}
              </p>
              <div style={{ marginTop: spacing[2] }}>
                <DetailRow label="Leaf (auditHash)" value={result.proof.leaf} />
                <DetailRow
                  label="Position"
                  value={`${result.proof.leafIndex + 1} of ${result.proof.leafCount}`}
                />
                <DetailRow label="Committed root" value={result.proof.root} />
                <DetailRow label="Proof length" value={`${result.proof.path.length} steps`} />
              </div>
            </>
          )}
        </section>
      )}
    </main>
  )
}
