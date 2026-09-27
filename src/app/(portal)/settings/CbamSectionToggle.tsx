'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

// Whether CBAM appears in the navigation before the organisation has any CBAM
// documents or cases. Once it has, the section shows regardless.

export function CbamSectionToggle({
  initialValue,
  hasActivity,
  isAdmin,
}: {
  initialValue: boolean
  hasActivity: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !enabled
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/cbam-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        setError('This could not be saved. Please try again.')
        return
      }
      setEnabled(next)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3], marginBottom: spacing[3] }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>Show CBAM</p>
        <p style={{ ...textStyles.sectionSubtitle, lineHeight: '1.6' }}>
          {hasActivity
            ? 'CBAM is shown because you have customs declarations or import cases.'
            : 'For businesses that import steel, aluminium, cement, fertilisers or hydrogen. Switch it on to check whether your goods are covered before you upload anything.'}
        </p>
        {error && (
          <p style={{ ...textStyles.caption, color: colours.red, marginTop: spacing[1] }}>{error}</p>
        )}
      </div>
      {!hasActivity && isAdmin && (
        <button
          onClick={toggle}
          disabled={saving}
          style={{
            flexShrink: 0,
            padding: '8px 20px',
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            color: enabled ? colours.surface : colours.textSecondary,
            backgroundColor: enabled ? colours.navy : colours.background,
            border: `1px solid ${enabled ? colours.navy : colours.border}`,
            borderRadius: '4px',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {saving ? 'Saving…' : enabled ? 'Shown' : 'Hidden'}
        </button>
      )}
    </div>
  )
}
