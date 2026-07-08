'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

export function BenchmarkConsentToggle({ initialValue }: { initialValue: boolean }) {
  const [enabled, setEnabled] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function toggle() {
    const next = !enabled
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/benchmark-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow: next }),
      })
      if (res.ok) {
        setEnabled(next)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
        padding: spacing[3],
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3] }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ ...textStyles.eyebrow, marginBottom: spacing[1] }}>
            Sector benchmarks
          </p>
          <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>
            Contribute to anonymous sector data
          </p>
          <p style={{ ...textStyles.sectionSubtitle, lineHeight: '1.6' }}>
            When enabled, your verified records are included in anonymised statistical benchmarks for your sector.
            Your business is never identified. Benchmarks require at least 10 businesses before any figure is shown.
            You can withdraw consent at any time. Your records are removed from future benchmark calculations.
          </p>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <button
            onClick={toggle}
            disabled={saving}
            style={{
              padding: '8px 20px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: enabled ? colours.surface : colours.textSecondary,
              backgroundColor: enabled ? colours.green : colours.background,
              border: `1px solid ${enabled ? colours.green : colours.border}`,
              borderRadius: '4px',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {saving ? 'Saving…' : enabled ? 'Enabled' : 'Disabled'}
          </button>
          {saved && (
            <p style={{ ...textStyles.caption, color: colours.green }}>
              Saved
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
