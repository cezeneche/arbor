'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles, borders } from '@/lib/design-system'

// Inline period picker for the verifier package — no modal, per the design rules.
// Collapsed it is a single button; expanded it asks for two dates and nothing else.
//
// Wording follows the audience split: an SME supplier is told what the thing is
// for in plain English, a buyer gets the domain term they already use.

interface Props {
  /** Suppliers get plain English; buyers get the technical label. */
  plain: boolean
  /** False when the entity's plan does not include package generation (PRD §22.4). */
  allowed: boolean
  /** Shown instead of the control when the plan does not include it. */
  deniedReason?: string
}

export function AuditPackageDownload({ plain, allowed, deniedReason }: Props) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const buttonStyle = {
    padding: '10px 20px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: borders.radius.sm,
    textDecoration: 'none',
    display: 'inline-block',
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
  }

  if (!allowed) {
    return (
      <div style={{ maxWidth: '280px', textAlign: 'right' }}>
        <p style={{ ...textStyles.caption, color: colours.textTertiary }}>
          {deniedReason ?? 'Your plan does not include verifier packages.'}
        </p>
      </div>
    )
  }

  const label = plain ? 'Pack for an auditor' : 'Download audit package'

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={buttonStyle}>
        {label}
      </button>
    )
  }

  // An unset date means "everything" — stated rather than left to be guessed.
  const params = new URLSearchParams()
  if (from) params.set('periodStart', new Date(from).toISOString())
  if (to) params.set('periodEnd', new Date(`${to}T23:59:59.999Z`).toISOString())
  const href = `/api/audit-package/me${params.toString() ? `?${params}` : ''}`

  const inputStyle = {
    padding: '6px 10px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    border: `1px solid ${colours.border}`,
    borderRadius: borders.radius.sm,
    backgroundColor: colours.surface,
  }

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: borders.radius.lg,
        padding: spacing[2],
        maxWidth: '420px',
      }}
    >
      <p style={textStyles.rowTitle}>
        {plain ? 'Which dates should it cover?' : 'Package period'}
      </p>
      <p style={{ ...textStyles.caption, marginTop: '2px' }}>
        {plain
          ? 'Leave both blank to include everything you have.'
          : 'Leave blank for the entity’s full history.'}
      </p>

      <div style={{ display: 'flex', gap: spacing[1], alignItems: 'center', marginTop: spacing[2], flexWrap: 'wrap' }}>
        <label style={{ ...textStyles.caption, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {plain ? 'From' : 'Period start'}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...textStyles.caption, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {plain ? 'To' : 'Period end'}
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        </label>
      </div>

      {from && to && from > to && (
        <p style={{ ...textStyles.caption, color: colours.red, marginTop: spacing[1] }}>
          The first date needs to be on or before the second.
        </p>
      )}

      <div style={{ display: 'flex', gap: spacing[1], marginTop: spacing[2] }}>
        <a
          href={href}
          onClick={() => setOpen(false)}
          style={{
            ...buttonStyle,
            color: colours.surface,
            backgroundColor: colours.navy,
            border: `1px solid ${colours.navy}`,
            pointerEvents: from && to && from > to ? ('none' as const) : undefined,
            opacity: from && to && from > to ? 0.5 : 1,
          }}
        >
          {plain ? 'Create the pack' : 'Download'}
        </a>
        <button onClick={() => setOpen(false)} style={buttonStyle}>
          Cancel
        </button>
      </div>

      <p style={{ ...textStyles.caption, color: colours.textTertiary, marginTop: spacing[2] }}>
        {plain
          ? 'You get a zip file holding a readable summary, your records, and the original documents they came from.'
          : 'ZIP: README.md report, canonical package.json with Merkle inclusion proofs, and source documents.'}
      </p>
    </div>
  )
}
