'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

// The share page holds a hash, not the package file, so this button can only ask
// the hash question: did Arbor issue this, and is the entity's chain intact today.
// It deliberately does not claim the package itself has been verified — that needs
// the contents, and an auditor holding the file POSTs them instead.
interface Result {
  hashIssuedByArbor?: boolean
  entityChainIntact?: boolean
  entryCount?: number
  verifiedAt?: string
  reason?: string
}

export function ShareVerifyButton({ entityId, packageHash }: { entityId: string; packageHash: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [result, setResult] = useState<Result | null>(null)

  async function verify() {
    setState('loading')
    try {
      const qs = new URLSearchParams({ entityId, packageHash })
      const res = await fetch(`/api/audit/verify-public?${qs.toString()}`)
      const data = (await res.json()) as Result
      setResult(data)
    } catch {
      setResult({ hashIssuedByArbor: false, reason: 'Verification request failed' })
    } finally {
      setState('done')
    }
  }

  const confirmed = result?.hashIssuedByArbor === true && result?.entityChainIntact === true

  return (
    <div>
      <button
        type="button"
        onClick={verify}
        disabled={state === 'loading'}
        style={{
          padding: '10px 20px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: colours.surface,
          backgroundColor: colours.navy,
          border: 'none',
          borderRadius: '4px',
          cursor: state === 'loading' ? 'default' : 'pointer',
          opacity: state === 'loading' ? 0.6 : 1,
        }}
      >
        {state === 'loading' ? 'Verifying…' : 'Verify integrity'}
      </button>

      {state === 'done' && result && (
        <div
          style={{
            marginTop: spacing[2],
            padding: spacing[2],
            borderRadius: '6px',
            backgroundColor: confirmed ? colours.greenBg : colours.redBg,
            border: `1px solid ${confirmed ? colours.green : colours.red}`,
          }}
        >
          <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: confirmed ? colours.green : colours.red }}>
            {confirmed
              ? 'Issued by Arbor · audit chain intact'
              : result.hashIssuedByArbor
                ? 'Issued by Arbor · audit chain does not verify'
                : 'Could not confirm'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            {result.hashIssuedByArbor
              ? `${result.entryCount ?? 0} audit entries checked · ${result.verifiedAt ? new Date(result.verifiedAt).toLocaleString('en-GB') : ''}`
              : result.reason ?? 'This package could not be confirmed.'}
          </p>
        </div>
      )}
    </div>
  )
}
