'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

interface Props {
  name: string
  email: string
  role: string
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  CONTRIBUTOR: 'Contributor',
  VIEWER: 'Viewer',
  SYSTEM: 'System',
}

export function ProfileEditor({ name, email, role }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSave() {
    if (!value.trim()) { setError('Name cannot be empty.'); return }
    setSaving(true)
    setError(null)

    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: value.trim() }),
    })

    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not save changes.')
      return
    }

    setSuccess(true)
    setEditing(false)
    router.refresh()
    setTimeout(() => setSuccess(false), 3000)
  }

  const labelStyle = { ...textStyles.eyebrow, marginBottom: '4px' }

  const valueStyle = textStyles.value

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
    color: colours.textPrimary,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[3] }}>
        <div>
          <p style={textStyles.sectionTitle}>
            Your profile
          </p>
          <p style={{ ...textStyles.sectionSubtitle, marginTop: '4px' }}>
            Your name and contact details.
          </p>
        </div>
        {!editing && (
          <button
            onClick={() => { setEditing(true); setSuccess(false) }}
            style={{
              padding: '6px 14px',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.navy,
              backgroundColor: 'transparent',
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
              letterSpacing: typography.tracking.wide,
            }}
          >
            Edit
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div>
          <p style={labelStyle}>Name</p>
          {editing ? (
            <input
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              style={inputStyle}
              autoFocus
            />
          ) : (
            <p style={valueStyle}>{name}</p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Email</p>
          <p style={{ ...valueStyle, color: colours.textSecondary }}>{email}</p>
        </div>
        <div>
          <p style={labelStyle}>Role</p>
          <p style={valueStyle}>{ROLE_LABELS[role] ?? role}</p>
        </div>
      </div>

      {editing && (
        <div style={{ display: 'flex', gap: '10px', marginTop: spacing[2], alignItems: 'center' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '7px 16px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: saving ? colours.textTertiary : colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              letterSpacing: typography.tracking.wide,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(name); setError(null) }}
            style={{
              padding: '7px 16px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              backgroundColor: 'transparent',
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          {error && (
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red, margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      )}

      {success && (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.green, margin: `${spacing[1]} 0 0` }}>
          Name updated. Changes take effect on your next sign-in.
        </p>
      )}
    </div>
  )
}
