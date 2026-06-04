'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

export function BenchmarkConsent({
  entityId,
  initialConsent,
}: {
  entityId: string
  initialConsent: boolean
}) {
  const router = useRouter()
  const [opted, setOpted] = useState(initialConsent)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    setLoading(true)
    const res = await fetch(`/api/entities/${entityId}/benchmark-consent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allow: !opted }),
    })
    if (res.ok) {
      setOpted(prev => !prev)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <div
      style={{
        backgroundColor: opted ? colours.greenBg : colours.surface,
        border: `1px solid ${opted ? colours.green : colours.border}`,
        borderRadius: '8px',
        padding: spacing[3],
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: spacing[3],
      }}
    >
      <div>
        <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
          {opted ? 'You are contributing to sector benchmarks' : 'Contribute to sector benchmarks'}
        </p>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0`, lineHeight: '1.5' }}>
          {opted
            ? 'Your Tier A records are included in anonymised sector benchmarks. No individual company data is ever visible. You can opt out at any time.'
            : 'Share your anonymised Tier A records with the sector benchmark pool. Your data is never individually identifiable. Benchmarks require at least 10 companies to form.'}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        style={{
          flexShrink: 0,
          padding: '8px 18px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: opted ? colours.green : colours.navy,
          backgroundColor: 'transparent',
          border: `1px solid ${opted ? colours.green : colours.navy}`,
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? '…' : opted ? 'Opt out' : 'Opt in'}
      </button>
    </div>
  )
}
