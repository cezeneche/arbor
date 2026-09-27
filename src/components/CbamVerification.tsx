'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, spacing, typography, textStyles } from '@/lib/design-system'
import type { PresentedVerification } from '@/lib/nucleos/verification-presenter'

// The verification of one goods line's emissions figure: its state, and the one
// action that moves it on — add a statement, decide on one, or retry adding one.
// Everything is inline; nothing opens over the page.

const input = {
  width: '100%',
  maxWidth: '260px',
  padding: '6px 8px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  backgroundColor: colours.surface,
  marginBottom: spacing[1],
} as const

const primary = {
  padding: '6px 14px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  color: colours.surface,
  backgroundColor: colours.navy,
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
} as const

const secondary = {
  padding: '6px 14px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  backgroundColor: 'transparent',
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  cursor: 'pointer',
} as const

const TONE: Record<string, string> = {
  verified: colours.green,
  received: colours.navy,
  rejected: colours.red,
  unsynced: colours.amber,
  unverified: colours.textSecondary,
}

export function CbamVerification({
  caseId,
  goodsLineId,
  verification,
}: {
  caseId: string
  goodsLineId: string
  verification: PresentedVerification
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!verification.applicable) {
    return <span style={{ ...textStyles.caption, color: colours.textTertiary }}>Not needed</span>
  }

  const base = `/api/cbam/cases/${encodeURIComponent(caseId)}/goods-lines/${encodeURIComponent(goodsLineId)}/verification`
  const statementBase = verification.statementId ? `${base}/${encodeURIComponent(verification.statementId)}` : null

  async function send(url: string, init: RequestInit) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, init)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'That did not work. Please try again.')
        return
      }
      if (body.synced === false && body.problem) setError(body.problem)
      setOpen(false)
      setRejecting(false)
      router.refresh()
    } catch {
      setError('That did not work. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function upload(form: HTMLFormElement) {
    await send(base, { method: 'POST', body: new FormData(form) })
  }

  return (
    <div style={{ minWidth: '200px' }}>
      <span
        style={{
          display: 'block',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: TONE[verification.state ?? 'unverified'],
        }}
      >
        {verification.label}
      </span>
      {verification.detail && (
        <span style={{ display: 'block', ...textStyles.caption, color: colours.textSecondary, marginTop: '2px' }}>
          {verification.detail}
        </span>
      )}
      {statementBase && verification.state !== 'unverified' && (
        <a
          href={`${statementBase}/file`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...textStyles.caption, color: colours.navy, display: 'inline-block', marginTop: '4px' }}
        >
          View statement
        </a>
      )}

      {verification.action === 'upload' && !open && (
        <button type="button" onClick={() => setOpen(true)} style={{ ...secondary, marginTop: spacing[1] }}>
          Add verifier’s statement
        </button>
      )}
      {verification.action === 'upload' && open && (
        <form
          onSubmit={e => {
            e.preventDefault()
            void upload(e.currentTarget)
          }}
          style={{ marginTop: spacing[1] }}
        >
          <input name="verifierName" placeholder="Verifier, e.g. Carbon Assurance Ltd" required style={input} />
          <input name="verifierAccreditation" placeholder="Accreditation, e.g. UKAS 9876" required style={input} />
          <input name="file" type="file" accept="application/pdf" required style={{ ...input, border: 'none', padding: 0 }} />
          <div style={{ display: 'flex', gap: spacing[1] }}>
            <button type="submit" disabled={busy} style={{ ...primary, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Adding…' : 'Add statement'}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={secondary}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {verification.action === 'decide' && statementBase && !rejecting && (
        <div style={{ display: 'flex', gap: spacing[1], marginTop: spacing[1] }}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void send(`${statementBase}/decision`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: 'accept' }),
              })
            }
            style={{ ...primary, opacity: busy ? 0.7 : 1 }}
          >
            Accept
          </button>
          <button type="button" onClick={() => setRejecting(true)} style={secondary}>
            Reject
          </button>
        </div>
      )}
      {verification.action === 'decide' && statementBase && rejecting && (
        <div style={{ marginTop: spacing[1] }}>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why is it rejected? This is kept with the statement."
            rows={2}
            style={{ ...input, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: spacing[1] }}>
            <button
              type="button"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                void send(`${statementBase}/decision`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ decision: 'reject', reason }),
                })
              }
              style={{ ...primary, backgroundColor: colours.red, opacity: busy || reason.trim() === '' ? 0.7 : 1 }}
            >
              Reject statement
            </button>
            <button type="button" onClick={() => setRejecting(false)} style={secondary}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {verification.action === 'retry' && statementBase && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(`${statementBase}/sync`, { method: 'POST' })}
          style={{ ...secondary, marginTop: spacing[1] }}
        >
          {busy ? 'Trying…' : 'Try again'}
        </button>
      )}

      {error && (
        <span style={{ display: 'block', ...textStyles.caption, color: colours.red, marginTop: '4px' }}>{error}</span>
      )}
    </div>
  )
}
