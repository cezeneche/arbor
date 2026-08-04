'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, textStyles, borders } from '@/lib/design-system'

// Naming who looks after each kind of data. Saved on change, confirmed inline —
// no modal, no separate save step to forget.

export interface CoverageRow {
  domain: string
  domainLabel: string
  stewardUserId: string | null
  stewardName: string | null
  openFlags: number
}

export interface Member {
  id: string
  name: string
  email: string
}

export function StewardEditor({
  coverage,
  members,
  canEdit,
}: {
  coverage: CoverageRow[]
  members: Member[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function setSteward(domain: string, userId: string) {
    setBusy(domain)
    setError(null)
    setSaved(null)
    try {
      const res = await fetch('/api/stewards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, userId: userId || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'That did not save. Try again.')
        return
      }
      setSaved(domain)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {error && (
        <p
          style={{
            ...textStyles.caption,
            color: colours.red,
            backgroundColor: colours.redBg,
            padding: spacing[1],
            borderRadius: borders.radius.sm,
          }}
        >
          {error}
        </p>
      )}

      {coverage.map(row => {
        // An unowned domain that already has open findings is the case worth
        // seeing: work exists and nobody is accountable for it.
        const unownedWithWork = !row.stewardUserId && row.openFlags > 0
        return (
          <div
            key={row.domain}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: spacing[2],
              padding: `10px ${spacing[1]}`,
              borderRadius: borders.radius.sm,
              backgroundColor: unownedWithWork ? colours.amberBg : 'transparent',
            }}
          >
            <div>
              <p style={textStyles.rowTitle}>{row.domainLabel}</p>
              <p style={{ ...textStyles.caption, marginTop: '2px' }}>
                {row.openFlags === 0
                  ? 'Nothing outstanding'
                  : `${row.openFlags} thing${row.openFlags === 1 ? '' : 's'} to check`}
                {unownedWithWork && ' · nobody is looking after this'}
                {saved === row.domain && ' · saved'}
              </p>
            </div>

            {canEdit ? (
              <select
                value={row.stewardUserId ?? ''}
                disabled={busy === row.domain}
                onChange={e => setSteward(row.domain, e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textPrimary,
                  border: `1px solid ${unownedWithWork ? colours.amber : colours.border}`,
                  borderRadius: borders.radius.sm,
                  backgroundColor: colours.surface,
                  minWidth: '180px',
                }}
              >
                <option value="">Nobody yet</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <p style={textStyles.value}>{row.stewardName ?? 'Nobody yet'}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
