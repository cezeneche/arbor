'use client'

import { useState } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import type { SupplierFormContext } from '@/lib/nucleos/supplier-form-client'

// Three fields, and no more. Every additional question measurably reduces the
// response rate, and these three are the minimum that produces a usable actual
// figure — an intensity, the route it was produced by, and optionally which
// installation.
//
// Plain English throughout: the person filling this in has no Arbor account, no
// CBAM background, and no reason to know what "specific embedded emissions"
// means. The regulatory term appears once, in the hint, so the figure they take
// off their own paperwork matches what is being asked for.

export function SupplierForm({
  token,
  context,
}: {
  token: string
  context: SupplierFormContext
}) {
  const [intensity, setIntensity] = useState('')
  const [route, setRoute] = useState(context.production_routes[0]?.key ?? '')
  const [installation, setInstallation] = useState(context.installation_name ?? '')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setState('sending')
    try {
      const res = await fetch(`/api/supplier-form/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          see_tco2e_per_t: Number(intensity),
          production_route: route,
          installation_name: installation || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Your figure could not be saved. Please try again.')
        setState('idle')
        return
      }
      setState('sent')
    } catch {
      setError('Your figure could not be saved. Please check your connection and try again.')
      setState('idle')
    }
  }

  if (state === 'sent') {
    return (
      <div>
        <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
          Thank you — that is everything we needed.
        </h1>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: spacing[2] }}>
          {context.importer_name ?? 'The company that contacted you'} has your figure.
          You do not need to do anything else, and you can close this page.
        </p>
      </div>
    )
  }

  const label = {
    display: 'block',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    marginBottom: '4px',
  }
  const hint = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: `0 0 6px`,
  }
  const input = {
    width: '100%',
    padding: spacing[2],
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
  }

  return (
    <form onSubmit={submit}>
      <div style={{ marginBottom: spacing[4] }}>
        <label htmlFor="intensity" style={label}>
          How much CO₂e does one tonne of these goods produce?
        </label>
        <p style={hint}>
          In tonnes of CO₂e per tonne of product — the direct specific embedded
          emissions figure from your own records. For example, 1.8.
        </p>
        <input
          id="intensity"
          type="number"
          step="any"
          min="0"
          required
          inputMode="decimal"
          value={intensity}
          onChange={e => setIntensity(e.target.value)}
          style={input}
        />
      </div>

      <div style={{ marginBottom: spacing[4] }}>
        <label htmlFor="route" style={label}>
          How were they produced?
        </label>
        <p style={hint}>
          This decides which published figure your number is checked against.
        </p>
        <select
          id="route"
          required
          value={route}
          onChange={e => setRoute(e.target.value)}
          style={input}
        >
          {context.production_routes.map(r => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: spacing[4] }}>
        <label htmlFor="installation" style={label}>
          Which site produced them? <span style={{ fontWeight: typography.weights.light, color: colours.textSecondary }}>Optional</span>
        </label>
        <input
          id="installation"
          type="text"
          value={installation}
          onChange={e => setInstallation(e.target.value)}
          style={input}
        />
      </div>

      {error && (
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.amber, marginBottom: spacing[3] }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === 'sending'}
        style={{
          padding: `${spacing[2]} ${spacing[4]}`,
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          color: '#FFFFFF',
          backgroundColor: colours.navy,
          border: 'none',
          borderRadius: '4px',
          cursor: state === 'sending' ? 'default' : 'pointer',
          opacity: state === 'sending' ? 0.6 : 1,
        }}
      >
        {state === 'sending' ? 'Sending…' : 'Send figure'}
      </button>
    </form>
  )
}
