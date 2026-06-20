'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

interface Status {
  connected: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
}

const PROVIDERS = [
  { id: 'CDS', name: 'HMRC Customs (CDS)', fields: [{ key: 'accessToken', label: 'OAuth access token' }], connector: true },
  { id: 'SAP', name: 'SAP S/4HANA', fields: [{ key: 'baseUrl', label: 'Base URL' }, { key: 'basicAuth', label: 'Basic auth (base64)' }], connector: true },
  { id: 'NETSUITE', name: 'Oracle NetSuite', fields: [{ key: 'accountUrl', label: 'Account URL' }, { key: 'accessToken', label: 'Access token' }], connector: true },
  { id: 'ORACLE', name: 'Oracle Cloud ERP', fields: [], connector: false },
] as const

export function IntegrationManager({ initialStatus }: { initialStatus: Record<string, Status> }) {
  const router = useRouter()
  const [openProvider, setOpenProvider] = useState<string | null>(null)
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(providerId: string) {
    setBusy(true); setError(null)
    const res = await fetch(`/api/integrations/${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: creds }),
    })
    setBusy(false)
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to connect.'); return }
    setOpenProvider(null); setCreds({}); router.refresh()
  }

  async function disconnect(providerId: string) {
    setBusy(true)
    await fetch(`/api/integrations/${providerId}`, { method: 'DELETE' })
    setBusy(false); router.refresh()
  }

  async function syncNow(providerId: string) {
    setBusy(true)
    await fetch(`/api/integrations/${providerId}/sync`, { method: 'POST' })
    setBusy(false); router.refresh()
  }

  const input = {
    width: '100%', padding: '8px 10px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light,
    border: `1px solid ${colours.border}`, borderRadius: '4px', backgroundColor: colours.surface,
    color: colours.textPrimary, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, marginBottom: '8px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {error && <p style={{ fontSize: typography.sizes.sm, color: colours.red, margin: 0 }}>{error}</p>}
      {PROVIDERS.map((p) => {
        const st = initialStatus[p.id]
        const connected = !!st?.connected
        return (
          <div key={p.id} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] }}>
              <div>
                <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, display: 'flex', alignItems: 'center', gap: spacing[1] }}>
                  {p.name}
                  {connected && (
                    <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.green, backgroundColor: colours.greenBg, border: `1px solid ${colours.green}`, borderRadius: '10px', padding: '1px 8px' }}>
                      Connected
                    </span>
                  )}
                </p>
                {!p.connector ? (
                  <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                    No pre-built connector. Use the ingest API with the Oracle field-mapping guide.
                  </p>
                ) : connected ? (
                  <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                    {st?.lastSyncAt ? `Last sync ${new Date(st.lastSyncAt).toLocaleString('en-GB')} · ${st?.lastSyncStatus ?? ''}` : 'Not synced yet'}
                  </p>
                ) : null}
              </div>

              {p.connector && (
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  {connected ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => syncNow(p.id)} style={btn(colours.navy, colours.surface)}>Sync now</button>
                      <button type="button" disabled={busy} onClick={() => disconnect(p.id)} style={btnOutline()}>Disconnect</button>
                    </>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setOpenProvider(openProvider === p.id ? null : p.id); setCreds({}) }} style={btn(colours.navy, colours.surface)}>
                      {openProvider === p.id ? 'Cancel' : 'Connect'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {openProvider === p.id && p.connector && (
              <div style={{ marginTop: spacing[2] }}>
                {p.fields.map((f) => (
                  <input
                    key={f.key}
                    type="text"
                    placeholder={f.label}
                    value={creds[f.key] ?? ''}
                    onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                    style={input}
                  />
                ))}
                <button
                  type="button"
                  disabled={busy || p.fields.some((f) => !creds[f.key])}
                  onClick={() => connect(p.id)}
                  style={{ ...btn(colours.navy, colours.surface), opacity: p.fields.some((f) => !creds[f.key]) ? 0.6 : 1 }}
                >
                  {busy ? 'Saving…' : 'Save connection'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function btn(bg: string, fg: string) {
  return { padding: '8px 16px', backgroundColor: bg, color: fg, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, border: 'none', borderRadius: '4px', cursor: 'pointer' as const }
}
function btnOutline() {
  return { padding: '8px 16px', backgroundColor: 'transparent', color: colours.red, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, border: `1px solid ${colours.border}`, borderRadius: '4px', cursor: 'pointer' as const }
}
