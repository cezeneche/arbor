'use client'

import { useState } from 'react'
import Image from 'next/image'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

type Step = 'idle' | 'scanning' | 'confirming' | 'recovery' | 'disabling'

const labelStyle = {
  display: 'block',
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textSecondary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  marginBottom: '6px',
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
}

const btnPrimary = (disabled: boolean) => ({
  padding: '10px 18px',
  backgroundColor: disabled ? colours.navyHover : colours.navy,
  color: colours.surface,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  border: 'none',
  borderRadius: '4px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  letterSpacing: typography.tracking.wide,
})

const btnGhost = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: colours.navy,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  cursor: 'pointer',
  letterSpacing: 0,
}

interface Props {
  enabled: boolean
  isAdmin: boolean
}

export function TwoFactorSetup({ enabled, isAdmin }: Props) {
  const [step, setStep] = useState<Step>('idle')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [manualSecret, setManualSecret] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isEnabled, setIsEnabled] = useState(enabled)

  async function startSetup() {
    setError(null)
    setLoading(true)
    const res = await fetch('/api/auth/2fa/setup', { method: 'POST' }).catch(() => null)
    setLoading(false)
    if (!res?.ok) { setError('Could not start setup. Try again.'); return }
    const data = await res.json()
    setQrDataUrl(data.qrDataUrl)
    setManualSecret(data.secret)
    setStep('scanning')
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await fetch('/api/auth/2fa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: confirmCode.replace(/\s/g, '') }),
    }).catch(() => null)
    setLoading(false)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? 'Code incorrect. Try again.')
      return
    }
    const data = await res.json()
    setRecoveryCodes(data.recoveryCodes)
    setIsEnabled(true)
    setStep('recovery')
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: disableCode.replace(/\s/g, '') }),
    }).catch(() => null)
    setLoading(false)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? 'Code incorrect. Try again.')
      return
    }
    setIsEnabled(false)
    setStep('idle')
    setError(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={textStyles.sectionTitle}>
            Two-factor authentication
          </p>
          <p style={{ ...textStyles.sectionSubtitle, marginTop: '4px' }}>
            {isEnabled
              ? 'Your account is protected with an authenticator app.'
              : 'Add a second layer of security using an authenticator app.'}
          </p>
        </div>
        <span
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            padding: '3px 10px',
            borderRadius: '12px',
            letterSpacing: typography.tracking.wide,
            backgroundColor: isEnabled ? colours.greenBg : colours.background,
            color: isEnabled ? colours.green : colours.textTertiary,
            border: `1px solid ${isEnabled ? colours.green : colours.border}`,
            whiteSpace: 'nowrap' as const,
          }}
        >
          {isEnabled ? 'On' : 'Off'}
        </span>
      </div>

      {/* STEP: idle - not set up */}
      {step === 'idle' && !isEnabled && (
        <div style={{ marginTop: spacing[2] }}>
          <button onClick={startSetup} disabled={loading} style={btnPrimary(loading)}>
            {loading ? 'Starting…' : 'Set up authenticator'}
          </button>
          {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, margin: `${spacing[1]} 0 0` }}>{error}</p>}
        </div>
      )}

      {/* STEP: idle - already enabled */}
      {step === 'idle' && isEnabled && (
        <div style={{ marginTop: spacing[2] }}>
          {isAdmin ? (
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
              Administrators must keep two-factor authentication enabled.
            </p>
          ) : (
            <button
              onClick={() => { setStep('disabling'); setError(null) }}
              style={{
                ...btnGhost,
                color: colours.red,
                fontSize: typography.sizes.sm,
              }}
            >
              Remove 2FA
            </button>
          )}
        </div>
      )}

      {/* STEP: scanning - show QR code */}
      {step === 'scanning' && (
        <div style={{ marginTop: spacing[2] }}>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[2]}` }}>
            Scan this code with your authenticator app (Google Authenticator, Authy, or similar), then enter the code it shows below.
          </p>
          {qrDataUrl && (
            <div style={{ marginBottom: spacing[2] }}>
              <Image src={qrDataUrl} alt="2FA QR code" width={160} height={160} style={{ display: 'block', borderRadius: '4px' }} />
            </div>
          )}
          <details style={{ marginBottom: spacing[2] }}>
            <summary style={{ fontSize: typography.sizes.xs, color: colours.textTertiary, cursor: 'pointer', userSelect: 'none' }}>
              Can&apos;t scan? Enter the code manually
            </summary>
            <p style={{ fontFamily: 'monospace', fontSize: typography.sizes.sm, color: colours.textPrimary, wordBreak: 'break-all', margin: '8px 0 0', letterSpacing: '0.05em' }}>
              {manualSecret}
            </p>
          </details>
          <form onSubmit={confirmSetup} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
            <div>
              <label htmlFor="confirm-code" style={labelStyle}>Code from your app</label>
              <input
                id="confirm-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={confirmCode}
                onChange={e => setConfirmCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                required
                placeholder="000000"
                style={{ ...inputStyle, letterSpacing: '0.2em', textAlign: 'center' }}
              />
            </div>
            {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
              <button type="submit" disabled={loading} style={btnPrimary(loading)}>
                {loading ? 'Confirming…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => { setStep('idle'); setError(null) }} style={btnGhost}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STEP: recovery - show codes once */}
      {step === 'recovery' && (
        <div style={{ marginTop: spacing[2] }}>
          <div style={{ backgroundColor: colours.amberBg, border: `1px solid ${colours.amber}`, borderRadius: '4px', padding: spacing[2], marginBottom: spacing[2] }}>
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.amber, margin: '0 0 4px' }}>
              Save these recovery codes now
            </p>
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.amber, margin: 0 }}>
              If you lose access to your authenticator, these codes let you sign in. Each code can only be used once. They won&apos;t be shown again.
            </p>
          </div>
          <div style={{
            backgroundColor: colours.background,
            border: `1px solid ${colours.border}`,
            borderRadius: '4px',
            padding: spacing[2],
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginBottom: spacing[2],
            fontFamily: 'monospace',
            fontSize: typography.sizes.sm,
          }}>
            {recoveryCodes.map(c => (
              <span key={c} style={{ color: colours.textPrimary, letterSpacing: '0.05em' }}>{c}</span>
            ))}
          </div>
          <button
            onClick={() => setStep('idle')}
            style={btnPrimary(false)}
          >
            I&apos;ve saved my recovery codes
          </button>
        </div>
      )}

      {/* STEP: disabling */}
      {step === 'disabling' && (
        <div style={{ marginTop: spacing[2] }}>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[2]}` }}>
            Enter your authenticator code to confirm you want to remove two-factor authentication.
          </p>
          <form onSubmit={handleDisable} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
            <div>
              <label htmlFor="disable-code" style={labelStyle}>Authenticator code</label>
              <input
                id="disable-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                required
                placeholder="000000"
                style={{ ...inputStyle, letterSpacing: '0.2em', textAlign: 'center', maxWidth: '200px' }}
              />
            </div>
            {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
              <button type="submit" disabled={loading} style={{ ...btnPrimary(loading), backgroundColor: loading ? '#c0a0a0' : colours.red }}>
                {loading ? 'Removing…' : 'Remove 2FA'}
              </button>
              <button type="button" onClick={() => { setStep('idle'); setError(null) }} style={btnGhost}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
