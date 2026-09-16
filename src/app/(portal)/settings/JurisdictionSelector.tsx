'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, spacing, textStyles, typography } from '@/lib/design-system'
import { CBAM_JURISDICTIONS, type CbamJurisdiction } from '@/lib/nucleos/jurisdiction'

// Where you import to.
//
// Phrased as a question about the business, not about regulation: an office
// manager knows which side of the Channel their goods land on, and does not
// need to know that the answer selects between two emissions regimes and two
// return formats. The detail under each option says what it means for them, in
// plain English and with no citations.
//
// Inline confirmation, no modal — the design rules forbid dialogs, and the
// choice is reversible.

export function JurisdictionSelector({
  initialValue,
  isAdmin,
}: {
  initialValue: CbamJurisdiction
  isAdmin: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState<CbamJurisdiction>(initialValue)
  const [saving, setSaving] = useState<CbamJurisdiction | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(next: CbamJurisdiction) {
    if (next === value || saving) return
    setSaving(next)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/settings/cbam-jurisdiction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jurisdiction: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not save that.')
        return
      }
      setValue(next)
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save that.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <p style={{ ...textStyles.sectionTitle, marginBottom: '4px' }}>Where you import to</p>
      <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[2], lineHeight: '1.6' }}>
        {isAdmin
          ? 'This decides which rules your imported goods are read under, and which return Arbor can prepare. Changing it applies to documents read from now on — figures already saved are untouched.'
          : 'Contact your account administrator to change this.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
        {CBAM_JURISDICTIONS.map(option => {
          const active = option.id === value
          return (
            <button
              key={option.id}
              onClick={() => isAdmin && choose(option.id)}
              disabled={!isAdmin || saving !== null}
              style={{
                textAlign: 'left',
                padding: spacing[2],
                border: `1px solid ${active ? colours.navy : colours.border}`,
                borderRadius: '6px',
                backgroundColor: active ? colours.background : colours.surface,
                cursor: isAdmin && !active && saving === null ? 'pointer' : 'default',
                fontFamily: 'inherit',
                opacity: saving !== null && saving !== option.id ? 0.6 : 1,
                width: '100%',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: spacing[2],
                }}
              >
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: active ? typography.weights.medium : typography.weights.light,
                    color: colours.textPrimary,
                  }}
                >
                  {option.label}
                </span>
                {saving === option.id ? (
                  <span style={{ ...textStyles.caption, color: colours.textTertiary }}>Saving…</span>
                ) : active ? (
                  <span
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.navy,
                      letterSpacing: typography.tracking.wide,
                    }}
                  >
                    SELECTED
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  display: 'block',
                  ...textStyles.caption,
                  marginTop: '4px',
                  lineHeight: '1.6',
                }}
              >
                {option.detail}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <p style={{ ...textStyles.caption, color: colours.red, marginTop: spacing[1] }}>{error}</p>
      )}
      {saved && (
        <p style={{ ...textStyles.caption, color: colours.green, marginTop: spacing[1] }}>Saved.</p>
      )}
    </div>
  )
}
