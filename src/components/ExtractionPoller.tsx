'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, spacing, textStyles } from '@/lib/design-system'

const POLL_INTERVAL_MS = 3000
const MAX_ATTEMPTS = 40 // ~2 minutes at 3s intervals

export function ExtractionPoller({ documentId }: { documentId: string }) {
  const router = useRouter()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let attempts = 0

    const interval = setInterval(async () => {
      attempts++

      if (attempts > MAX_ATTEMPTS) {
        clearInterval(interval)
        setFailed(true)
        return
      }

      try {
        const res = await fetch(`/api/documents/${documentId}`, { cache: 'no-store' })
        if (!res.ok) return

        const data = await res.json()

        if (data.status === 'FAILED') {
          clearInterval(interval)
          setFailed(true)
          return
        }

        if (data.status !== 'EXTRACTING' && data.status !== 'PENDING') {
          clearInterval(interval)
          router.refresh()
        }
      } catch {
        // Network error - keep polling; will surface as timeout after MAX_ATTEMPTS.
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [documentId, router])

  if (failed) {
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
        <p
          style={textStyles.sectionTitle}
        >
          Extraction could not be completed
        </p>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          The document may be unsupported or unreadable. Try uploading it again.
        </p>
      </div>
    )
  }

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
        style={textStyles.sectionTitle}
      >
        Reading your document…
      </p>
      <p
        style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
      >
        This usually takes 10–30 seconds.
      </p>
    </div>
  )
}
