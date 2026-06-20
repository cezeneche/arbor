'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

export function SsoSetup({ initialOrgId }: { initialOrgId: string | null }) {
  const router = useRouter()
  const [orgId, setOrgId] = useState(initialOrgId ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(value: string | null) {
    setBusy(true); setError(null); setMessage(null)
    const res = await fetch('/api/workos/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workosOrganisationId: value }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return }
    setMessage(value ? 'SSO connection saved.' : 'SSO disconnected.')
    router.refresh()
  }

  const input = {
    width: '100%', padding: '10px 12px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light,
    border: `1px solid ${colours.border}`, borderRadius: '4px', backgroundColor: colours.surface,
    color: colours.textPrimary, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3], maxWidth: '560px' }}>
      <label style={{ display: 'block', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase' as const, marginBottom: '6px' }}>
        WorkOS organisation ID
      </label>
      <input
        type="text"
        placeholder="org_..."
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        style={input}
      />
      <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '6px 0 0' }}>
        Create an organisation and SSO connection in your WorkOS dashboard, then paste its organisation ID here. Once connected, members of your verified domain sign in via your IdP.
      </p>

      {message && <p style={{ fontSize: typography.sizes.sm, color: colours.green, margin: `${spacing[2]} 0 0` }}>{message}</p>}
      {error && <p style={{ fontSize: typography.sizes.sm, color: colours.red, margin: `${spacing[2]} 0 0` }}>{error}</p>}

      <div style={{ display: 'flex', gap: spacing[2], marginTop: spacing[3] }}>
        <button
          type="button"
          disabled={busy || orgId.trim() === ''}
          onClick={() => save(orgId.trim())}
          style={{ padding: '10px 20px', backgroundColor: colours.navy, color: colours.surface, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, border: 'none', borderRadius: '4px', cursor: busy || orgId.trim() === '' ? 'default' : 'pointer', opacity: orgId.trim() === '' ? 0.6 : 1 }}
        >
          {busy ? 'Saving…' : 'Save connection'}
        </button>
        {initialOrgId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { setOrgId(''); save(null) }}
            style={{ padding: '10px 20px', backgroundColor: 'transparent', color: colours.red, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, border: `1px solid ${colours.border}`, borderRadius: '4px', cursor: 'pointer' }}
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}
