'use client'

import { useState } from 'react'
import Image from 'next/image'
import { signOut } from 'next-auth/react'
import { colours, typography, spacing } from '@/lib/design-system'

type Step = 'intro' | 'scanning' | 'recovery'

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
  letterSpacing: '0.2em',
  textAlign: 'center' as const,
}

const btnPrimary = (disabled: boolean) => ({
  padding: '12px',
  width: '100%',
  backgroundColor: disabled ? colours.navyHover : colours.navy,
  color: colours.surface,
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.medium,
  border: 'none',
  borderRadius: '4px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  letterSpacing: typography.tracking.wide,
})

export function MandatoryTwoFactorSetup() {
  const [step, setStep] = useState<Step>('intro')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [manualSecret, setManualSecret] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function startSetup() {
    setError(null)
    setLoading(true)
    const res = await fetch('/api/auth/2fa/setup', { method: 'POST' }).catch(() => null)
    setLoading(false)
    if (!res?.ok) { setError('Could not start setup. Please try again.'); return }
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
      body: JSON.stringify({ code: code.replace(/\s/g, '') }),
    }).catch(() => null)
    setLoading(false)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? 'Code incorrect. Please try again.')
      return
    }
    const data = await res.json()
    setRecoveryCodes(data.recoveryCodes)
    setStep('recovery')
  }

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
        padding: spacing[6],
        width: '100%',
        maxWidth: '440px',
      }}
    >
      <div style={{ marginBottom: spacing[4] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Secure your administrator account
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
            lineHeight: '1.6',
          }}
        >
          Two-factor authentication is required for all administrators. Set it up now
          to continue.
        </p>
      </div>

      {/* STEP: intro */}
      {step === 'intro' && (
        <>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[3]}`, lineHeight: '1.6' }}>
            You&apos;ll need an authenticator app such as Google Authenticator, Authy, or
            1Password. We&apos;ll show a QR code to scan, then ask for the 6-digit code it
            generates.
          </p>
          {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, margin: `0 0 ${spacing[2]}` }}>{error}</p>}
          <button onClick={startSetup} disabled={loading} style={btnPrimary(loading)}>
            {loading ? 'Starting…' : 'Begin setup'}
          </button>
        </>
      )}

      {/* STEP: scanning */}
      {step === 'scanning' && (
        <>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[2]}`, lineHeight: '1.6' }}>
            Scan this code with your authenticator app, then enter the 6-digit code below.
          </p>
          {qrDataUrl && (
            <div style={{ marginBottom: spacing[2], display: 'flex', justifyContent: 'center' }}>
              <Image src={qrDataUrl} alt="2FA QR code" width={180} height={180} style={{ borderRadius: '4px' }} />
            </div>
          )}
          <details style={{ marginBottom: spacing[3] }}>
            <summary style={{ fontSize: typography.sizes.xs, color: colours.textTertiary, cursor: 'pointer', userSelect: 'none' }}>
              Can&apos;t scan? Enter the code manually
            </summary>
            <p style={{ fontFamily: 'monospace', fontSize: typography.sizes.sm, color: colours.textPrimary, wordBreak: 'break-all', margin: '8px 0 0', letterSpacing: '0.05em' }}>
              {manualSecret}
            </p>
          </details>
          <form onSubmit={confirmSetup} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
            <div>
              <label htmlFor="code" style={labelStyle}>Code from your app</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                required
                placeholder="000000"
                style={inputStyle}
              />
            </div>
            {error && <p style={{ color: colours.red, fontSize: typography.sizes.sm, margin: 0 }}>{error}</p>}
            <button type="submit" disabled={loading} style={btnPrimary(loading)}>
              {loading ? 'Verifying…' : 'Verify and enable'}
            </button>
          </form>
        </>
      )}

      {/* STEP: recovery codes */}
      {step === 'recovery' && (
        <>
          <div style={{ backgroundColor: colours.amberBg, border: `1px solid ${colours.amber}`, borderRadius: '4px', padding: spacing[2], marginBottom: spacing[3] }}>
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.amber, margin: '0 0 4px' }}>
              Save these recovery codes now
            </p>
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.amber, margin: 0, lineHeight: '1.6' }}>
              If you lose access to your authenticator, these codes are the only way back into
              your account. Each works once. They won&apos;t be shown again.
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
            marginBottom: spacing[3],
            fontFamily: 'monospace',
            fontSize: typography.sizes.sm,
          }}>
            {recoveryCodes.map(c => (
              <span key={c} style={{ color: colours.textPrimary, letterSpacing: '0.05em' }}>{c}</span>
            ))}
          </div>
          {/* Full reload so the portal layout re-reads twoFactorEnabled from the DB. */}
          <a href="/dashboard" style={{ textDecoration: 'none' }}>
            <button style={btnPrimary(false)}>I&apos;ve saved my recovery codes — continue</button>
          </a>
        </>
      )}

      <p style={{ textAlign: 'center', margin: `${spacing[3]} 0 0` }}>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{ background: 'none', border: 'none', color: colours.textTertiary, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </p>
    </div>
  )
}
