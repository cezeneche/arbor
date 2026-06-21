'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

interface Subscription {
  id: string
  url: string
  events: string[]
  secretPrefix: string
  isActive: boolean
  createdAt: string
  lastDeliveryAt: string | null
  lastDeliveryStatus: string | null
}

const EVENT_OPTIONS = [
  { value: 'RECORD_CERTIFIED', label: 'Record certified' },
  { value: 'RECORD_SUPERSEDED', label: 'Record superseded' },
  { value: 'ACCESS_GRANTED', label: 'Access granted' },
  { value: 'ACCESS_REVOKED', label: 'Access revoked' },
]

export function WebhookManager({ initialSubscriptions }: { initialSubscriptions: Subscription[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['RECORD_CERTIFIED'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  function toggleEvent(v: string) {
    setEvents((prev) => (prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]))
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!url.startsWith('https://')) { setError('URL must use HTTPS.'); return }
    if (events.length === 0) { setError('Select at least one event.'); return }
    setBusy(true); setError(null)
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, events }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return }
    setNewSecret(data.signingSecret)
    setOpen(false)
    setUrl('')
    setEvents(['RECORD_CERTIFIED'])
    router.refresh()
  }

  async function remove(id: string) {
    setBusy(true)
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    setBusy(false)
    setConfirmDelete(null)
    router.refresh()
  }

  const input = {
    width: '100%', padding: '10px 12px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light,
    border: `1px solid ${colours.border}`, borderRadius: '4px', backgroundColor: colours.surface,
    color: colours.textPrimary, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const,
  }

  return (
    <div>
      {newSecret && (
        <div style={{ backgroundColor: colours.greenBg, border: `1px solid ${colours.green}`, borderRadius: '6px', padding: spacing[2], marginBottom: spacing[3] }}>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.green, margin: `0 0 6px` }}>
            Signing secret - copy it now. This is the only time it will be shown.
          </p>
          <code style={{ fontSize: typography.sizes.sm, fontFamily: 'monospace', color: colours.textPrimary, wordBreak: 'break-all' as const }}>
            {newSecret}
          </code>
          <div>
            <button
              type="button"
              onClick={() => setNewSecret(null)}
              style={{ marginTop: '8px', padding: '4px 10px', backgroundColor: 'transparent', color: colours.textSecondary, border: `1px solid ${colours.border}`, borderRadius: '4px', fontSize: typography.sizes.xs, cursor: 'pointer' }}
            >
              I&apos;ve saved it
            </button>
          </div>
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ padding: '10px 20px', backgroundColor: colours.navy, color: colours.surface, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, border: 'none', borderRadius: '4px', cursor: 'pointer', letterSpacing: typography.tracking.wide, marginBottom: spacing[4] }}
        >
          Add webhook
        </button>
      ) : (
        <form onSubmit={create} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[3], marginBottom: spacing[4] }}>
          <label style={{ display: 'block', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase' as const, marginBottom: '6px' }}>
            Endpoint URL
          </label>
          <input type="url" placeholder="https://example.com/webhooks/arbor" value={url} onChange={(e) => setUrl(e.target.value)} style={input} />

          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textSecondary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase' as const, margin: `${spacing[2]} 0 6px` }}>
            Events
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {EVENT_OPTIONS.map((opt) => (
              <label key={opt.value} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, cursor: 'pointer' }}>
                <input type="checkbox" checked={events.includes(opt.value)} onChange={() => toggleEvent(opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>

          {error && <p style={{ fontSize: typography.sizes.sm, color: colours.red, margin: `${spacing[2]} 0 0` }}>{error}</p>}

          <div style={{ display: 'flex', gap: '12px', marginTop: spacing[3] }}>
            <button type="button" onClick={() => { setOpen(false); setError(null) }} style={{ padding: '10px 20px', backgroundColor: 'transparent', color: colours.textSecondary, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, border: `1px solid ${colours.border}`, borderRadius: '4px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={busy} style={{ padding: '10px 20px', backgroundColor: colours.navy, color: colours.surface, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, border: 'none', borderRadius: '4px', cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Creating…' : 'Create webhook'}
            </button>
          </div>
        </form>
      )}

      <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
        {initialSubscriptions.length === 0 ? (
          <p style={{ padding: spacing[3], fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
            No webhooks yet.
          </p>
        ) : (
          initialSubscriptions.map((s, i) => (
            <div key={s.id} style={{ padding: spacing[2], borderBottom: i < initialSubscriptions.length - 1 ? `1px solid ${colours.border}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, wordBreak: 'break-all' as const }}>{s.url}</p>
                <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, margin: '2px 0 0' }}>
                  {s.events.join(', ').toLowerCase().replace(/_/g, ' ')}
                </p>
                <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '2px 0 0' }}>
                  {s.secretPrefix}… · {s.lastDeliveryStatus ? `last delivery ${s.lastDeliveryStatus}` : 'no deliveries yet'}
                </p>
              </div>
              {confirmDelete === s.id ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button type="button" disabled={busy} onClick={() => remove(s.id)} style={{ padding: '6px 12px', backgroundColor: colours.red, color: colours.surface, border: 'none', borderRadius: '4px', fontSize: typography.sizes.xs, cursor: 'pointer' }}>Confirm</button>
                  <button type="button" onClick={() => setConfirmDelete(null)} style={{ padding: '6px 12px', backgroundColor: 'transparent', color: colours.textSecondary, border: `1px solid ${colours.border}`, borderRadius: '4px', fontSize: typography.sizes.xs, cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(s.id)} style={{ padding: '6px 12px', backgroundColor: 'transparent', color: colours.red, border: `1px solid ${colours.border}`, borderRadius: '4px', fontSize: typography.sizes.xs, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>Delete</button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
