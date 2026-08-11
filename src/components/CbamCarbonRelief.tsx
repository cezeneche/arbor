'use client'

import { useState, useEffect } from 'react'
import { colours, typography, spacing } from '@/lib/design-system'
import { CbamCasePicker } from './CbamCasePicker'
import { qualifyingScheme, netLiability, missingForCalculation } from '@/lib/nucleos/cpr-form'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'

// Claiming relief for carbon already paid in the country of origin.
//
// Two guards shape this screen. First, relief is only claimable where the origin
// country actually runs a qualifying scheme — so the form does not appear at all
// where it does not, rather than appearing and failing on submit. Second, the
// figures are previewed before anything is claimed: this is money against an
// HMRC return, and a claim is not the place to discover a mistyped exchange rate.
//
// The relief itself is calculated by Nucleos. Reimplementing the formula here
// would produce a second answer that eventually disagrees with the one on the
// filed return — and the user would have already seen and trusted this one.

interface GoodsLine {
  id: string
  cn_code?: string | null
  description?: string | null
  sector?: string | null
}

interface CprResult {
  cpr_amount_gbp: string
  effective_carbon_price_gbp: string
  cpr_raw_gbp: string
  cpr_capped: boolean
  cbam_liability_gbp: string
  net_price_local: string
  warnings: string[]
}

function money(value: number | string | null, currency = 'GBP'): string {
  if (value === null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-GB', { style: 'currency', currency, minimumFractionDigits: 2 })
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: `6px 0`,
      }}
    >
      <span
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: emphasis ? typography.weights.medium : typography.weights.light,
          color: emphasis ? colours.navy : colours.textPrimary,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function CaseRelief({ case_ }: { case_: CbamCaseSummary }) {
  const scheme = qualifyingScheme(case_.origin_country)

  const [lines, setLines] = useState<GoodsLine[]>([])
  const [lineId, setLineId] = useState('')
  const [emissions, setEmissions] = useState('')
  const [price, setPrice] = useState('')
  const [allocations, setAllocations] = useState('0')
  const [rate, setRate] = useState('')
  const [verifier, setVerifier] = useState('')
  const [verifierBody, setVerifierBody] = useState('')

  const [phase, setPhase] = useState<'form' | 'preview' | 'done'>('form')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CprResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scheme.eligible) return
    let cancelled = false
    fetch(`/api/cbam/cases/${case_.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled || !body) return
        const gl: GoodsLine[] = body.goods_lines ?? []
        setLines(gl)
        if (gl[0]) setLineId(gl[0].id)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [case_.id, scheme.eligible])

  if (!scheme.eligible) {
    // Shown rather than hidden: an importer who expected relief needs to know
    // why there is none, not find an empty panel.
    return (
      <div style={{ padding: `${spacing[4]} 0`, borderTop: `1px solid ${colours.border}` }}>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: 0,
            lineHeight: 1.6,
            maxWidth: '520px',
          }}
        >
          {case_.origin_country
            ? `Goods from ${case_.origin_country} are not covered by a carbon pricing scheme that UK CBAM recognises, so no relief can be claimed against them.`
            : 'This case has no country of origin recorded, and relief depends on which scheme the carbon price was paid under.'}
        </p>
      </div>
    )
  }

  const missing = missingForCalculation({
    verifiedEmissions: emissions,
    carbonPrice: price,
    exchangeRate: rate,
  })

  async function calculate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cbam/cpr-calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          verified_emissions_tco2e: Number(emissions),
          carbon_price_local: Number(price),
          currency_code: scheme.currency,
          free_allocations: Number(allocations || '0'),
          rebates: 0,
          exchange_rate_to_gbp: Number(rate),
          cbam_liability_gbp: case_.estimated_liability_gbp ?? 0,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'The relief could not be calculated.')
        return
      }
      setResult(body as CprResult)
      setPhase('preview')
    } catch {
      setError('The relief could not be calculated. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cbam/cpr-claims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goods_line_id: lineId,
          origin_country_code: (case_.origin_country ?? '').toUpperCase(),
          qualifying_scheme_name: scheme.schemeName,
          carbon_price_local_currency: Number(price),
          local_currency_code: scheme.currency,
          free_allocations_received: Number(allocations || '0'),
          rebates_received: 0,
          verified_emissions_tco2e: Number(emissions),
          exchange_rate_to_gbp: Number(rate),
          exchange_rate_date: new Date().toISOString().slice(0, 10),
          cbam_liability_gbp: case_.estimated_liability_gbp ?? 0,
          verifier_name: verifier || null,
          verifier_accreditation_body: verifierBody || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'The claim could not be recorded.')
        return
      }
      setPhase('done')
    } catch {
      setError('The claim could not be recorded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const section: React.CSSProperties = {
    padding: `${spacing[4]} 0`,
    borderTop: `1px solid ${colours.border}`,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: spacing[2],
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    fontFamily: 'inherit',
    color: colours.textPrimary,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.light,
    color: colours.textSecondary,
    margin: `0 0 4px`,
  }
  const primary = (disabled: boolean): React.CSSProperties => ({
    padding: `${spacing[2]} ${spacing[4]}`,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    fontFamily: 'inherit',
    color: '#FFFFFF',
    backgroundColor: colours.navy,
    border: 'none',
    borderRadius: '4px',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  })

  if (phase === 'done') {
    return (
      <div style={section}>
        <p
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.green,
            margin: `0 0 ${spacing[2]}`,
          }}
        >
          Claim recorded
        </p>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: 0,
            lineHeight: 1.6,
            maxWidth: '520px',
          }}
        >
          The relief will reduce the liability on this case&apos;s return. A verifier&apos;s
          report confirming the carbon price paid is required before the return is
          submitted — the claim is recorded as unverified until one is attached.
        </p>
      </div>
    )
  }

  if (phase === 'preview' && result) {
    const relief = Number(result.cpr_amount_gbp)
    const net = netLiability(case_.estimated_liability_gbp, relief)

    return (
      <div style={section}>
        <div style={{ maxWidth: '460px' }}>
          <Row label="Effective carbon price" value={money(result.effective_carbon_price_gbp)} />
          <Row label="Relief before any cap" value={money(result.cpr_raw_gbp)} />
          <Row label="Relief claimed" value={money(result.cpr_amount_gbp)} emphasis />
          <div style={{ borderTop: `1px solid ${colours.border}`, margin: `${spacing[2]} 0` }} />
          <Row label="CBAM liability" value={money(result.cbam_liability_gbp)} />
          <Row
            label="Left owing after relief"
            value={net === null ? 'Not yet known' : money(net)}
            emphasis
          />

          {result.cpr_capped && (
            <p
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.amber,
                lineHeight: 1.6,
                margin: `${spacing[3]} 0 0`,
              }}
            >
              The relief was capped at the CBAM liability. Relief reduces what is owed; it
              is not refunded beyond it.
            </p>
          )}

          {result.warnings?.length > 0 && (
            <ul
              style={{
                margin: `${spacing[3]} 0 0`,
                paddingLeft: '18px',
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.amber,
                lineHeight: 1.6,
              }}
            >
              {result.warnings.map(w => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {!verifier && (
            <p
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                lineHeight: 1.6,
                margin: `${spacing[3]} 0 0`,
              }}
            >
              No verifier recorded. The claim can still be made, and will be marked
              unverified until a GACI-accredited verifier&apos;s report is attached.
            </p>
          )}

          <div style={{ display: 'flex', gap: spacing[3], marginTop: spacing[4] }}>
            <button onClick={submit} disabled={busy} style={primary(busy)}>
              {busy ? 'Recording…' : 'Claim this relief'}
            </button>
            <button
              onClick={() => setPhase('form')}
              style={{
                padding: `${spacing[2]} ${spacing[4]}`,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                fontFamily: 'inherit',
                color: colours.textSecondary,
                backgroundColor: 'transparent',
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Change the figures
            </button>
          </div>

          {error && (
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.amber,
                margin: `${spacing[3]} 0 0`,
              }}
            >
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={section}>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `0 0 ${spacing[4]}`,
          lineHeight: 1.6,
          maxWidth: '520px',
        }}
      >
        Carbon paid under the {scheme.schemeName} can be set against this case&apos;s CBAM
        liability. Figures are in {scheme.currency}, converted at the rate you give.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: spacing[3],
          maxWidth: '620px',
          marginBottom: spacing[4],
        }}
      >
        {lines.length > 1 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <p style={labelStyle}>Goods line</p>
            <select
              value={lineId}
              onChange={e => setLineId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {lines.map(l => (
                <option key={l.id} value={l.id}>
                  {l.cn_code ?? 'No code'} · {l.description || l.sector || 'No description'}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <p style={labelStyle}>Verified emissions (tCO₂e)</p>
          <input
            type="number"
            min={0}
            step="0.01"
            value={emissions}
            onChange={e => setEmissions(e.target.value)}
            placeholder="e.g. 12.50"
            style={inputStyle}
          />
        </div>

        <div>
          <p style={labelStyle}>Carbon price paid ({scheme.currency} per tCO₂e)</p>
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="e.g. 72.40"
            style={inputStyle}
          />
        </div>

        <div>
          <p style={labelStyle}>Free allocations received (tCO₂e)</p>
          <input
            type="number"
            min={0}
            step="0.01"
            value={allocations}
            onChange={e => setAllocations(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <p style={labelStyle}>Exchange rate to GBP</p>
          <input
            type="number"
            min={0}
            step="0.0001"
            value={rate}
            onChange={e => setRate(e.target.value)}
            placeholder="e.g. 0.8500"
            style={inputStyle}
          />
        </div>

        <div>
          <p style={labelStyle}>Verifier (optional)</p>
          <input value={verifier} onChange={e => setVerifier(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <p style={labelStyle}>Accreditation body (optional)</p>
          <input
            value={verifierBody}
            onChange={e => setVerifierBody(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      <button
        onClick={calculate}
        disabled={busy || missing.length > 0}
        style={primary(busy || missing.length > 0)}
      >
        {busy ? 'Calculating…' : 'Preview the relief'}
      </button>

      {missing.length > 0 && (
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: colours.textTertiary,
            margin: `${spacing[2]} 0 0`,
          }}
        >
          Still needed: {missing.join(', ')}.
        </p>
      )}

      {error && (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.amber,
            margin: `${spacing[3]} 0 0`,
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}

export function CbamCarbonRelief({ cases }: { cases: CbamCaseSummary[] }) {
  return (
    <div>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `0 0 ${spacing[4]}`,
          lineHeight: 1.6,
          maxWidth: '620px',
        }}
      >
        Where carbon has already been paid in the country of origin, it can be set against
        the CBAM liability. Open a case to work out what it is worth.
      </p>
      <CbamCasePicker
        cases={cases}
        emptyMessage="There are no cases yet. Relief is claimed against a case, so start one from Cases first."
      >
        {c => <CaseRelief case_={c} />}
      </CbamCasePicker>
    </div>
  )
}
