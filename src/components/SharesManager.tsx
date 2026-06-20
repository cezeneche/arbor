'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'

interface ShareRow {
  id: string
  token: string
  domain: string | null
  periodStart: string | null
  periodEnd: string | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  state: 'active' | 'revoked' | 'expired'
}

const DOMAINS = ['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']

const inputStyle = {
  padding: '7px 10px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  backgroundColor: colours.surface,
} as const

export function SharesManager({ initial, origin }: { initial: ShareRow[]; origin: string }) {
  const [shares, setShares] = useState<ShareRow[]>(initial)
  const [domain, setDomain] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setCreating(true)
    setError(null)
    setNewUrl(null)
    try {
      const body: Record<string, string> = {}
      if (domain) body.domain = domain
      if (periodStart) body.periodStart = new Date(periodStart).toISOString()
      if (periodEnd) body.periodEnd = new Date(periodEnd).toISOString()
      if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString()
      const res = await fetch('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not create share')
      setNewUrl(data.url)
      setShares((s) => [
        { id: data.id, token: data.token, domain: domain || null, periodStart: body.periodStart ?? null, periodEnd: body.periodEnd ?? null, createdAt: new Date().toISOString(), expiresAt: body.expiresAt ?? null, revokedAt: null, state: 'active' },
        ...s,
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create share')
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/shares/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setShares((s) => s.map((x) => (x.id === id ? { ...x, state: 'revoked', revokedAt: new Date().toISOString() } : x)))
    }
  }

  return (
    <div>
      {/* Create — one primary action, inline, no modal. */}
      <div style={{ padding: spacing[3], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', marginBottom: spacing[4] }}>
        <p style={{ margin: `0 0 ${spacing[2]}`, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
          Create a shareable link
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing[2] }}>
          <label style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            <div style={{ marginBottom: '4px' }}>Data type (optional)</div>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} style={inputStyle}>
              <option value="">All data</option>
              {DOMAINS.map((d) => (
                <option key={d} value={d}>{d.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            <div style={{ marginBottom: '4px' }}>From</div>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            <div style={{ marginBottom: '4px' }}>To</div>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
            <div style={{ marginBottom: '4px' }}>Link expires (optional)</div>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={inputStyle} />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            style={{ padding: '8px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1 }}
          >
            {creating ? 'Creating…' : 'Create link'}
          </button>
        </div>

        {error && <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.sizes.sm, color: colours.red }}>{error}</p>}

        {newUrl && (
          <div style={{ marginTop: spacing[2], padding: spacing[2], backgroundColor: colours.greenBg, border: `1px solid ${colours.green}`, borderRadius: '6px' }}>
            <p style={{ margin: 0, fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.green, letterSpacing: typography.tracking.wide, textTransform: 'uppercase' }}>
              Link ready — anyone with it can view this data
            </p>
            <div style={{ display: 'flex', gap: spacing[1], alignItems: 'center', marginTop: '6px' }}>
              <input readOnly value={newUrl} style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(newUrl)}
                style={{ padding: '7px 14px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '4px', cursor: 'pointer' }}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List */}
      {shares.length === 0 ? (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
          No shared links yet.
        </p>
      ) : (
        <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                {['Scope', 'Created', 'Expires', 'Status', 'Link', ''].map((c) => (
                  <th key={c} style={{ padding: '10px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', textAlign: 'left' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shares.map((s, i) => {
                const url = `${origin}/share/${s.token}`
                return (
                  <tr key={s.id} style={{ borderBottom: i < shares.length - 1 ? `1px solid ${colours.border}` : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>
                      {s.domain ? s.domain.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'All data'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                      {new Date(s.createdAt).toLocaleDateString('en-GB')}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                      {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('en-GB') : 'Never'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: s.state === 'active' ? colours.green : colours.textTertiary, textTransform: 'capitalize' }}>
                      {s.state}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {s.state === 'active' ? (
                        <button type="button" onClick={() => navigator.clipboard?.writeText(url)} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.navy, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          Copy link
                        </button>
                      ) : (
                        <span style={{ fontSize: typography.sizes.xs, color: colours.textTertiary }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {s.state === 'active' && (
                        <button type="button" onClick={() => revoke(s.id)} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.red, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
