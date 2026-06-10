'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

interface Props {
  legalName: string
  registrationNumber: string | null
  country: string
  sector: string
  entityType: string
  isAdmin: boolean
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  SUPPLIER: 'Supplier / manufacturer',
  BUYER: 'Buyer',
}

export function OrganisationEditor({ legalName, registrationNumber, country, sector, entityType, isAdmin }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState({ legalName, registrationNumber: registrationNumber ?? '', country, sector })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function setField(key: keyof typeof fields, val: string) {
    setFields(prev => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    if (!fields.legalName.trim()) { setError('Company name cannot be empty.'); return }
    if (fields.country.trim().length !== 2) { setError('Country must be a 2-letter ISO code (e.g. GB).'); return }
    if (!fields.sector.trim()) { setError('Sector cannot be empty.'); return }

    setSaving(true)
    setError(null)

    const res = await fetch('/api/entity', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        legalName: fields.legalName.trim(),
        registrationNumber: fields.registrationNumber.trim() || undefined,
        country: fields.country.trim().toUpperCase(),
        sector: fields.sector.trim(),
      }),
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

  const labelStyle = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    marginBottom: '4px',
  }

  const valueStyle = {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
  }

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
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
            Organisation
          </p>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `4px 0 0` }}>
            {isAdmin ? 'Company registration and classification details.' : 'Contact your account administrator to update these details.'}
          </p>
        </div>
        {isAdmin && !editing && (
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
        <div style={{ gridColumn: '1 / -1' }}>
          <p style={labelStyle}>Company name</p>
          {editing ? (
            <input type="text" value={fields.legalName} onChange={e => setField('legalName', e.target.value)} style={inputStyle} autoFocus />
          ) : (
            <p style={valueStyle}>{legalName}</p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Registration number</p>
          {editing ? (
            <input type="text" value={fields.registrationNumber} onChange={e => setField('registrationNumber', e.target.value)} placeholder="e.g. 12345678" style={inputStyle} />
          ) : (
            <p style={valueStyle}>{registrationNumber ?? <span style={{ color: colours.textTertiary }}>Not provided</span>}</p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Country</p>
          {editing ? (
            <input type="text" value={fields.country} onChange={e => setField('country', e.target.value)} maxLength={2} placeholder="GB" style={{ ...inputStyle, textTransform: 'uppercase' }} />
          ) : (
            <p style={valueStyle}>{country}</p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Sector</p>
          {editing ? (
            <input type="text" value={fields.sector} onChange={e => setField('sector', e.target.value)} placeholder="e.g. Steel manufacturing" style={inputStyle} />
          ) : (
            <p style={valueStyle}>{sector}</p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Account type</p>
          <p style={{ ...valueStyle, color: colours.textSecondary }}>{ENTITY_TYPE_LABELS[entityType] ?? entityType}</p>
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
            onClick={() => { setEditing(false); setFields({ legalName, registrationNumber: registrationNumber ?? '', country, sector }); setError(null) }}
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
          Organisation details updated.
        </p>
      )}
    </div>
  )
}
