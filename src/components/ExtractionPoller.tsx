'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

export function ExtractionPoller({ documentId }: { documentId: string }) {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/documents/${documentId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        if (data.status !== 'EXTRACTING' && data.status !== 'PENDING') {
          clearInterval(interval)
          router.refresh()
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [documentId, router])

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
        padding: spacing[6],
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: `3px solid ${colours.border}`,
          borderTopColor: colours.navy,
          borderRadius: '50%',
          margin: `0 auto ${spacing[3]}`,
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p
        style={{
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.medium,
          color: colours.textPrimary,
          margin: 0,
        }}
      >
        Reading your document…
      </p>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `${spacing[1]} 0 0`,
        }}
      >
        This usually takes 10–30 seconds.
      </p>
    </div>
  )
}
