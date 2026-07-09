'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

interface ApiKeyRow {
  id: string
  label: string
  lastUsed: string | null
  createdAt: string
  scope: 'READ' | 'READ_WRITE'
  expiresAt: string | null
}

const EXPIRY_OPTIONS: { label: string; days?: number }[] = [
  { label: 'Never' },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
]

export function ApiKeyManager({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState<'READ' | 'READ_WRITE'>('READ_WRITE')
  const [expiry, setExpiry] = useState('Never')
  const [ipAllowlist, setIpAllowlist] = useState('')
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null)

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setCreating(true)
    setError(null)
    setNewKey(null)

    const ips = ipAllowlist.split(',').map(s => s.trim()).filter(Boolean)
    const days = EXPIRY_OPTIONS.find(o => o.label === expiry)?.days
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        scope,
        ...(days ? { expiresInDays: days } : {}),
        ...(ips.length > 0 ? { ipAllowlist: ips } : {}),
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Could not create key.')
      setCreating(false)
      return
    }

    setNewKey(data.plaintext)
    setLabel('')
    setScope('READ_WRITE')
    setExpiry('Never')
    setIpAllowlist('')
    setCreating(false)
    router.refresh()
  }

  async function handleRevoke(id: string) {
    setRevoking(id)
    const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Could not revoke key.')
    }
    setRevoking(null)
    setRevokeConfirm(null)
    router.refresh()
  }

  function copyKey() {
    if (!newKey) return
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const fieldLabel = {
    display: 'block',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    marginBottom: '6px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[4] }}>

      {/* New key revealed once */}
      {newKey && (
        <div
          style={{
            backgroundColor: colours.greenBg,
            border: `1px solid ${colours.green}`,
            borderRadius: '6px',
            padding: spacing[3],
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.green,
              margin: `0 0 ${spacing[1]}`,
            }}
          >
            API key created. Copy it now. It will not be shown again.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                padding: '8px 12px',
                wordBreak: 'break-all' as const,
                display: 'block',
              }}
            >
              {newKey}
            </code>
            <button
              onClick={copyKey}
              style={{
                flexShrink: 0,
                padding: '8px 16px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                color: colours.surface,
                backgroundColor: colours.navy,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <section>
        <p style={sectionLabel}>Create a new key</p>
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
            padding: spacing[3],
          }}
        >
          <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: spacing[2], alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 200px' }}>
              <label htmlFor="label" style={fieldLabel}>Key label</label>
              <input
                id="label"
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Xero integration"
                required
                style={inputStyle}
              />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label htmlFor="scope" style={fieldLabel}>Access</label>
              <select id="scope" value={scope} onChange={e => setScope(e.target.value as 'READ' | 'READ_WRITE')} style={inputStyle}>
                <option value="READ_WRITE">Read &amp; write</option>
                <option value="READ">Read-only</option>
              </select>
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label htmlFor="expiry" style={fieldLabel}>Expires</label>
              <select id="expiry" value={expiry} onChange={e => setExpiry(e.target.value)} style={inputStyle}>
                {EXPIRY_OPTIONS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 220px' }}>
              <label htmlFor="ips" style={fieldLabel}>IP allowlist (optional)</label>
              <input
                id="ips"
                type="text"
                value={ipAllowlist}
                onChange={e => setIpAllowlist(e.target.value)}
                placeholder="e.g. 203.0.113.4, 198.51.100.7"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={creating || !label.trim()}
              style={{
                flexShrink: 0,
                padding: '10px 20px',
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                color: colours.surface,
                backgroundColor: creating || !label.trim() ? colours.textTertiary : colours.navy,
                border: 'none',
                borderRadius: '4px',
                cursor: creating || !label.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? 'Creating…' : 'Create key'}
            </button>
          </form>
          {error && (
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.red,
                margin: `${spacing[1]} 0 0`,
              }}
            >
              {error}
            </p>
          )}
        </div>
      </section>

      {/* Active keys */}
      <section>
        <p style={sectionLabel}>Active keys</p>
        {initialKeys.length === 0 ? (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[3],
            }}
          >
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: 0,
              }}
            >
              No active keys.
            </p>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {initialKeys.map((key, i) => (
              <div
                key={key.id}
                style={{
                  padding: spacing[2],
                  borderBottom: i < initialKeys.length - 1 ? `1px solid ${colours.border}` : 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: spacing[3],
                }}
              >
                <div>
                  <p
                    style={textStyles.sectionTitle}
                  >
                    {key.label}
                  </p>
                  <p
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textTertiary,
                      margin: '4px 0 0',
                    }}
                  >
                    {key.scope === 'READ' ? 'Read-only' : 'Read & write'}
                    {` · Created ${new Date(key.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    {key.lastUsed && ` · Last used ${new Date(key.lastUsed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    {!key.lastUsed && ' · Never used'}
                    {key.expiresAt && ` · Expires ${new Date(key.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  </p>
                </div>
                {revokeConfirm === key.id ? (
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      onClick={() => setRevokeConfirm(null)}
                      style={{
                        padding: '6px 12px',
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
                    <button
                      onClick={() => handleRevoke(key.id)}
                      disabled={revoking === key.id}
                      style={{
                        padding: '6px 12px',
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.medium,
                        color: colours.surface,
                        backgroundColor: revoking === key.id ? colours.textTertiary : colours.red,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: revoking === key.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {revoking === key.id ? 'Revoking…' : 'Confirm revoke'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevokeConfirm(key.id)}
                    style={{
                      flexShrink: 0,
                      padding: '6px 14px',
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      backgroundColor: 'transparent',
                      border: `1px solid ${colours.border}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
