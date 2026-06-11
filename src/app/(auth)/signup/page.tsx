'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'

const SECTORS = [
  { value: 'steel', label: 'Steel' },
  { value: 'aluminium', label: 'Aluminium' },
  { value: 'cement', label: 'Cement' },
  { value: 'fertilisers', label: 'Fertilisers' },
  { value: 'hydrogen', label: 'Hydrogen' },
  { value: 'manufacturing', label: 'Manufacturing (other)' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'other', label: 'Other' },
]

const COUNTRIES = [
  { value: 'GB', label: 'United Kingdom' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'PL', label: 'Poland' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'IE', label: 'Ireland' },
  { value: 'US', label: 'United States' },
  { value: 'CN', label: 'China' },
  { value: 'IN', label: 'India' },
  { value: 'OTHER', label: 'Other' },
]

export default function SignupPage() {
  const router = useRouter()
  const [entityType, setEntityType] = useState<'SUPPLIER' | 'BUYER'>('SUPPLIER')
  const [companyName, setCompanyName] = useState('')
  const [sector, setSector] = useState('')
  const [country, setCountry] = useState('GB')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, sector, country, name, email, password, entityType }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Try again.')
      setLoading(false)
      return
    }

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError('Account created but sign-in failed. Try signing in manually.')
      setLoading(false)
      return
    }

    router.push('/onboarding')
  }

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
    boxSizing: 'border-box' as const,
  }

  return (
    <div
      style={{
        backgroundColor: colours.surface,
        border: `1px solid ${colours.border}`,
        borderRadius: '8px',
        padding: spacing[6],
        width: '100%',
        maxWidth: '480px',
      }}
    >
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Arbor
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Create your account
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>

        {/* Entity type */}
        <div>
          <p style={{ ...labelStyle, marginBottom: '8px' }}>I am signing up as a</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {([
              { value: 'SUPPLIER', heading: 'Supplier / manufacturer', sub: 'I supply goods or services and need to manage my operational data' },
              { value: 'BUYER', heading: 'Buyer / large company', sub: 'I need verified operational data from my supply chain' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEntityType(opt.value)}
                style={{
                  padding: '12px',
                  border: `1.5px solid ${entityType === opt.value ? colours.navy : colours.border}`,
                  borderRadius: '4px',
                  backgroundColor: entityType === opt.value ? colours.background : colours.surface,
                  cursor: 'pointer',
                  textAlign: 'left' as const,
                }}
              >
                <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, marginBottom: '4px' }}>
                  {opt.heading}
                </div>
                <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, lineHeight: '1.4' }}>
                  {opt.sub}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${colours.border}`, marginTop: '4px' }} />

        <div>
          <label htmlFor="companyName" style={labelStyle}>Company name</label>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            required
            placeholder="e.g. Midlands Steel Ltd"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[2] }}>
          <div>
            <label htmlFor="sector" style={labelStyle}>Sector</label>
            <select
              id="sector"
              value={sector}
              onChange={e => setSector(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">Select…</option>
              {SECTORS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="country" style={labelStyle}>Country</label>
            <select
              id="country"
              value={country}
              onChange={e => setCountry(e.target.value)}
              required
              style={inputStyle}
            >
              {COUNTRIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${colours.border}`, marginTop: '4px' }} />

        <div>
          <label htmlFor="name" style={labelStyle}>Your name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            placeholder="e.g. Sarah Jones"
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="email" style={labelStyle}>Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="password" style={labelStyle}>Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              margin: '6px 0 0',
            }}
          >
            At least 8 characters
          </p>
        </div>

        {error && (
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.red,
              backgroundColor: colours.redBg,
              padding: '10px 12px',
              borderRadius: '4px',
              margin: 0,
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: spacing[1],
            padding: '12px',
            backgroundColor: loading ? colours.navyHover : colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            letterSpacing: typography.tracking.wide,
          }}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            textAlign: 'center',
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Already have an account?{' '}
          <Link
            href="/login"
            style={{ color: colours.navy, textDecoration: 'none', fontWeight: typography.weights.medium }}
          >
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
