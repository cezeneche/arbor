'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

type Result =
  | { verified: true; entryCount: number; verifiedAt: string }
  | { verified: false; reason?: string }

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
      setResult({ verified: false, reason: 'Verification request failed' })
    } finally {
      setState('done')
    }
  }

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
            backgroundColor: result.verified ? colours.greenBg : colours.redBg,
            border: `1px solid ${result.verified ? colours.green : colours.red}`,
          }}
        >
          <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: result.verified ? colours.green : colours.red }}>
            {result.verified ? 'Audit chain verified' : 'Could not verify'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            {result.verified
              ? `${result.entryCount} audit entries checked · ${new Date(result.verifiedAt).toLocaleString('en-GB')}`
              : (result as { reason?: string }).reason ?? 'This package could not be confirmed.'}
          </p>
        </div>
      )}
    </div>
  )
}
