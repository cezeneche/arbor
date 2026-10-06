'use client'

import { useCallback, useEffect, useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { CbamCasePicker } from './CbamCasePicker'
import { missingForCalculation } from '@/lib/nucleos/cpr-form'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'
import type { PresentedReliefClaim, SchemeChoice } from '@/lib/nucleos/relief-presenter'

// Claiming relief for carbon already paid in the country of origin, one goods
// line at a time.
//
// Relief belongs to a goods line: its origin decides which schemes qualify, and
// the return carries one claim per line — the newest. So the screen shows the
// line's claims first, then the one thing it needs next: a claim, the verifier's
// statement behind the claim that counts, or nothing.
//
// Which schemes qualify, and the currency each prices carbon in, comes from
// Nucleos. The relief itself is calculated by Nucleos too, and previewed before
// anything is claimed: this is money against an HMRC return.

interface GoodsLine {
  id: string
  cn_code?: string | null
  description?: string | null
  product_description?: string | null
  origin_country?: string | null
}

interface ReliefView {
  origin: string | null
  schemes: SchemeChoice
  claims: PresentedReliefClaim[]
  next: 'claim' | 'statement' | 'retry' | 'none'
  retryStatementId: string | null
  retryProblem: string | null
}

type HmrcRateAnswer = { held: true; rate: string; label: string } | { held: false; message: string }

interface CprResult {
  cpr_amount_gbp: string
  effective_carbon_price_gbp: string
  warnings: string[]
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

const labelStyle: React.CSSProperties = { ...textStyles.caption, margin: `0 0 4px` }

const primary = (disabled: boolean): React.CSSProperties => ({
  padding: `${spacing[2]} ${spacing[4]}`,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  fontFamily: 'inherit',
  color: colours.surface,
  backgroundColor: colours.navy,
  border: 'none',
  borderRadius: '4px',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.6 : 1,
})

const secondary: React.CSSProperties = {
  padding: `${spacing[2]} ${spacing[4]}`,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  fontFamily: 'inherit',
  color: colours.textSecondary,
  backgroundColor: 'transparent',
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  cursor: 'pointer',
}

const note = (colour: string): React.CSSProperties => ({
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.light,
  color: colour,
  lineHeight: 1.6,
  margin: `${spacing[2]} 0 0`,
  maxWidth: '520px',
})

function money(value: number | string | null): string {
  if (value === null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}
    >
      <span style={textStyles.sectionSubtitle}>{label}</span>
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

function lineBase(caseId: string, lineId: string) {
  return `/api/cbam/cases/${encodeURIComponent(caseId)}/goods-lines/${encodeURIComponent(lineId)}`
}

// ── The claims already made ─────────────────────────────────────────────────

function ClaimList({
  caseId,
  lineId,
  claims,
}: {
  caseId: string
  lineId: string
  claims: PresentedReliefClaim[]
}) {
  return (
    <div style={{ maxWidth: '620px', marginBottom: spacing[3] }}>
      {claims.map(claim => (
        <div
          key={claim.id}
          style={{
            padding: `${spacing[2]} 0`,
            borderBottom: `1px solid ${colours.border}`,
            opacity: claim.latest ? 1 : 0.7,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: spacing[2],
            }}
          >
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: claim.latest ? typography.weights.medium : typography.weights.light,
                color: claim.counts ? colours.navy : claim.latest ? colours.amber : colours.textTertiary,
              }}
            >
              {claim.status}
            </span>
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: claim.latest ? typography.weights.medium : typography.weights.light,
                color: colours.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {claim.amount}
            </span>
          </div>
          <p style={{ ...textStyles.caption, color: colours.textSecondary, margin: '4px 0 0' }}>
            {claim.scheme} · {claim.basis}
          </p>
          {claim.latest && (
            <>
              <p
                style={{
                  ...textStyles.caption,
                  color: claim.statement.attached ? colours.green : colours.amber,
                  margin: '4px 0 0',
                }}
              >
                {claim.statement.label}
                {claim.statement.statementId && (
                  <>
                    {' '}
                    <a
                      href={`${lineBase(caseId, lineId)}/verification/${encodeURIComponent(claim.statement.statementId)}/file`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: colours.navy }}
                    >
                      View statement
                    </a>
                  </>
                )}
              </p>
              {claim.qualifications.map(q => (
                <p key={q} style={note(colours.amber)}>
                  {q}
                </p>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ── The verifier's statement behind the claim that counts ──────────────────

function StatementForm({ caseId, lineId, onDone }: { caseId: string; lineId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [accreditation, setAccreditation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = name.trim() !== '' && accreditation.trim() !== '' && file !== null

  async function submit() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('verifierName', name)
      form.set('verifierAccreditation', accreditation)
      const res = await fetch(`${lineBase(caseId, lineId)}/relief/statement`, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((body as { error?: string }).error ?? 'The statement could not be added.')
        return
      }
      if ((body as { problem?: string | null }).problem) setError((body as { problem: string }).problem)
      onDone()
    } catch {
      setError('The statement could not be added. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p
        style={{
          ...textStyles.sectionSubtitle,
          margin: `0 0 ${spacing[3]}`,
          lineHeight: 1.6,
          maxWidth: '520px',
        }}
      >
        Attach the accredited verifier&apos;s statement confirming the carbon price paid. Until it is
        attached, the relief is not counted on the return.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: spacing[3],
          maxWidth: '620px',
          marginBottom: spacing[3],
        }}
      >
        <div>
          <p style={labelStyle}>Verifier</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
            aria-label="Verifier"
          />
        </div>
        <div>
          <p style={labelStyle}>Accreditation, for example UKAS 9876</p>
          <input
            value={accreditation}
            onChange={e => setAccreditation(e.target.value)}
            style={inputStyle}
            aria-label="Accreditation"
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <p style={labelStyle}>Statement (PDF, up to 20 MB)</p>
          <input
            type="file"
            accept="application/pdf"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            aria-label="Statement"
          />
        </div>
      </div>
      <button onClick={submit} disabled={busy || !ready} style={primary(busy || !ready)}>
        {busy ? 'Attaching…' : 'Attach the statement'}
      </button>
      {error && <p style={note(colours.amber)}>{error}</p>}
    </div>
  )
}

// ── A new claim ─────────────────────────────────────────────────────────────

function ClaimForm({
  case_,
  lineId,
  origin,
  options,
  replacing,
  onDone,
}: {
  case_: CbamCaseSummary
  lineId: string
  origin: string
  options: SchemeChoice['options']
  replacing: boolean
  onDone: () => void
}) {
  const [schemeName, setSchemeName] = useState(options[0]?.name ?? '')
  const scheme = options.find(o => o.name === schemeName) ?? options[0]
  const [typedCurrency, setTypedCurrency] = useState('')
  const currency = (scheme?.currency ?? typedCurrency).trim().toUpperCase()

  const [emissions, setEmissions] = useState('')
  const [price, setPrice] = useState('')
  const [allocations, setAllocations] = useState('0')
  const [rate, setRate] = useState('')
  const [rateTyped, setRateTyped] = useState(false)
  const [rateDate, setRateDate] = useState('')
  // HMRC's rate for the month of the rate date, kept with the currency and date
  // it answers, so a changed currency or date never shows a stale answer.
  const [hmrc, setHmrc] = useState<{ key: string; answer: HmrcRateAnswer } | null>(null)
  const rateKey =
    /^[A-Z]{3}$/.test(currency) && /^\d{4}-\d{2}-\d{2}$/.test(rateDate) ? `${currency}|${rateDate}` : null
  const hmrcAnswer = hmrc && hmrc.key === rateKey ? hmrc.answer : null

  useEffect(() => {
    if (!rateKey) return
    let cancelled = false
    const [code, day] = rateKey.split('|')
    fetch(
      `/api/cbam/relief/exchange-rate?currency=${encodeURIComponent(code)}&date=${encodeURIComponent(day)}`,
    )
      .then(res => (res.ok ? res.json() : null))
      .then((answer: HmrcRateAnswer | null) => {
        if (cancelled || !answer) return
        setHmrc({ key: rateKey, answer })
        if (answer.held && !rateTyped) setRate(answer.rate)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [rateKey, rateTyped])
  const [verifier, setVerifier] = useState('')
  const [verifierBody, setVerifierBody] = useState('')

  const [phase, setPhase] = useState<'form' | 'preview'>('form')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CprResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const missing = missingForCalculation({
    verifiedEmissions: emissions,
    carbonPrice: price,
    currency,
    exchangeRate: rate,
    rateDate,
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
          currency_code: currency,
          free_allocations: Number(allocations || '0'),
          rebates: 0,
          exchange_rate_to_gbp: Number(rate),
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
          case_id: case_.id,
          goods_line_id: lineId,
          origin_country_code: origin,
          qualifying_scheme_name: scheme?.name,
          carbon_price_local_currency: Number(price),
          local_currency_code: currency,
          free_allocations_received: Number(allocations || '0'),
          rebates_received: 0,
          verified_emissions_tco2e: Number(emissions),
          exchange_rate_to_gbp: Number(rate),
          exchange_rate_date: rateDate,
          verifier_name: verifier || null,
          verifier_accreditation_body: verifierBody || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'The claim could not be recorded.')
        return
      }
      onDone()
    } catch {
      setError('The claim could not be recorded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'preview' && result) {
    return (
      <div style={{ maxWidth: '460px' }}>
        <Row label="Effective carbon price" value={money(result.effective_carbon_price_gbp)} />
        <Row label="Relief claimed" value={money(result.cpr_amount_gbp)} emphasis />
        <p style={note(colours.textSecondary)}>
          On the return, relief is capped at the CBAM charge on these goods: it reduces what is owed, and is
          never refunded beyond it.
        </p>
        {result.warnings?.map(w => (
          <p key={w} style={note(colours.amber)}>
            {w}
          </p>
        ))}
        {replacing && (
          <p style={note(colours.textSecondary)}>This claim replaces the one above on the return.</p>
        )}

        <div style={{ display: 'flex', gap: spacing[3], marginTop: spacing[4] }}>
          <button onClick={submit} disabled={busy} style={primary(busy)}>
            {busy ? 'Recording…' : 'Claim this relief'}
          </button>
          <button onClick={() => setPhase('form')} style={secondary}>
            Change the figures
          </button>
        </div>
        {error && <p style={note(colours.amber)}>{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <p
        style={{
          ...textStyles.sectionSubtitle,
          margin: `0 0 ${spacing[4]}`,
          lineHeight: 1.6,
          maxWidth: '520px',
        }}
      >
        {options.length === 1
          ? `Carbon paid under the ${scheme?.name} can be set against the CBAM liability on these goods.`
          : `Goods from ${origin} can carry relief under more than one scheme. Choose the one the carbon price was paid under.`}
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
        {options.length > 1 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <p style={labelStyle}>Scheme</p>
            <select
              value={schemeName}
              onChange={e => setSchemeName(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
              aria-label="Scheme"
            >
              {options.map(o => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {!scheme?.currency && (
          <div>
            <p style={labelStyle}>Currency the price was paid in, for example EUR</p>
            <input
              value={typedCurrency}
              onChange={e => setTypedCurrency(e.target.value)}
              maxLength={3}
              style={inputStyle}
              aria-label="Currency"
            />
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
            aria-label="Verified emissions"
          />
        </div>
        <div>
          <p style={labelStyle}>Carbon price paid ({currency || '…'} per tCO₂e)</p>
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="e.g. 72.40"
            style={inputStyle}
            aria-label="Carbon price"
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
            aria-label="Free allocations"
          />
        </div>
        <div>
          <p style={labelStyle}>Exchange rate to GBP</p>
          <input
            type="number"
            min={0}
            step="0.0001"
            value={rate}
            onChange={e => {
              setRate(e.target.value)
              setRateTyped(true)
            }}
            placeholder="e.g. 0.8500"
            style={inputStyle}
            aria-label="Exchange rate"
          />
          {hmrcAnswer && (
            <p
              style={{
                ...textStyles.caption,
                margin: '4px 0 0',
                color:
                  hmrcAnswer.held && rate !== '' && Number(rate) !== Number(hmrcAnswer.rate)
                    ? colours.amber
                    : colours.textTertiary,
              }}
            >
              {!hmrcAnswer.held
                ? hmrcAnswer.message
                : rate !== '' && Number(rate) !== Number(hmrcAnswer.rate)
                  ? `This differs from HMRC’s rate of ${hmrcAnswer.rate} for the month.`
                  : hmrcAnswer.label}
            </p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Date of the rate (normally the import date)</p>
          <input
            type="date"
            value={rateDate}
            onChange={e => setRateDate(e.target.value)}
            style={inputStyle}
            aria-label="Date of the exchange rate"
          />
        </div>
        <div>
          <p style={labelStyle}>Verifier (optional)</p>
          <input
            value={verifier}
            onChange={e => setVerifier(e.target.value)}
            style={inputStyle}
            aria-label="Claim verifier"
          />
        </div>
        <div>
          <p style={labelStyle}>Accreditation body (optional)</p>
          <input
            value={verifierBody}
            onChange={e => setVerifierBody(e.target.value)}
            style={inputStyle}
            aria-label="Accreditation body"
          />
        </div>
      </div>

      <button
        onClick={calculate}
        disabled={busy || missing.length > 0}
        style={replacing ? secondary : primary(busy || missing.length > 0)}
      >
        {busy ? 'Calculating…' : 'Preview the relief'}
      </button>
      {missing.length > 0 && (
        <p style={{ ...textStyles.caption, color: colours.textTertiary, margin: `${spacing[2]} 0 0` }}>
          Still needed: {missing.join(', ')}.
        </p>
      )}
      {error && <p style={note(colours.amber)}>{error}</p>}
    </div>
  )
}

// ── One goods line ──────────────────────────────────────────────────────────

export function LineRelief({ case_, lineId }: { case_: CbamCaseSummary; lineId: string }) {
  const [view, setView] = useState<ReliefView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claimingAgain, setClaimingAgain] = useState(false)
  const [busy, setBusy] = useState(false)

  const fetchView = useCallback(async (): Promise<{ view: ReliefView } | { error: string }> => {
    try {
      const res = await fetch(`${lineBase(case_.id, lineId)}/relief`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok)
        return { error: (body as { error?: string }).error ?? 'Relief for these goods could not be loaded.' }
      return { view: body as ReliefView }
    } catch {
      return { error: 'Relief for these goods could not be loaded. Check your connection and try again.' }
    }
  }, [case_.id, lineId])

  const apply = useCallback((result: { view: ReliefView } | { error: string }) => {
    if ('view' in result) {
      setView(result.view)
      setError(null)
      setClaimingAgain(false)
    } else {
      setError(result.error)
    }
  }, [])

  const load = useCallback(async () => apply(await fetchView()), [apply, fetchView])

  useEffect(() => {
    let cancelled = false
    fetchView().then(result => {
      if (!cancelled) apply(result)
    })
    return () => {
      cancelled = true
    }
  }, [apply, fetchView])

  async function retry(statementId: string) {
    setBusy(true)
    try {
      const res = await fetch(
        `${lineBase(case_.id, lineId)}/verification/${encodeURIComponent(statementId)}/sync`,
        {
          method: 'POST',
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setError((body as { error?: string }).error ?? 'The statement could not be added yet.')
      else await load()
    } finally {
      setBusy(false)
    }
  }

  if (error && !view) return <p style={note(colours.amber)}>{error}</p>
  if (!view) return <p style={{ ...textStyles.caption, color: colours.textTertiary }}>Loading…</p>

  const canClaim = view.schemes.eligible && view.origin !== null

  return (
    <div>
      {view.claims.length > 0 && <ClaimList caseId={case_.id} lineId={lineId} claims={view.claims} />}

      {!canClaim && (
        <p style={{ ...textStyles.sectionSubtitle, margin: 0, lineHeight: 1.6, maxWidth: '520px' }}>
          {view.schemes.message}
        </p>
      )}

      {canClaim && view.next === 'claim' && (
        <ClaimForm
          case_={case_}
          lineId={lineId}
          origin={view.origin!}
          options={view.schemes.options}
          replacing={false}
          onDone={load}
        />
      )}

      {view.next === 'statement' && <StatementForm caseId={case_.id} lineId={lineId} onDone={load} />}

      {view.next === 'retry' && view.retryStatementId && (
        <div>
          <p
            style={{
              ...textStyles.sectionSubtitle,
              margin: `0 0 ${spacing[3]}`,
              maxWidth: '520px',
              lineHeight: 1.6,
            }}
          >
            The verifier&apos;s statement is saved but has not been added to the claim yet. Nothing needs
            uploading again.
          </p>
          <button onClick={() => retry(view.retryStatementId!)} disabled={busy} style={primary(busy)}>
            {busy ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}

      {canClaim && view.claims.length > 0 && (
        <div style={{ marginTop: spacing[4] }}>
          {claimingAgain ? (
            <ClaimForm
              case_={case_}
              lineId={lineId}
              origin={view.origin!}
              options={view.schemes.options}
              replacing
              onDone={load}
            />
          ) : (
            <button onClick={() => setClaimingAgain(true)} style={secondary}>
              Claim again (replaces the claim that counts)
            </button>
          )}
        </div>
      )}

      {error && <p style={note(colours.amber)}>{error}</p>}
    </div>
  )
}

// ── One case ────────────────────────────────────────────────────────────────

function CaseRelief({ case_ }: { case_: CbamCaseSummary }) {
  const [lines, setLines] = useState<GoodsLine[] | null>(null)
  const [lineId, setLineId] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/cbam/cases/${encodeURIComponent(case_.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled) return
        const gl: GoodsLine[] = body?.goods_lines ?? []
        setLines(gl)
        if (gl[0]) setLineId(gl[0].id)
      })
      .catch(() => {
        if (!cancelled) setLines([])
      })
    return () => {
      cancelled = true
    }
  }, [case_.id])

  if (lines === null) {
    return (
      <div style={section}>
        <p style={{ ...textStyles.caption, color: colours.textTertiary }}>Loading…</p>
      </div>
    )
  }
  if (lines.length === 0) {
    return (
      <div style={section}>
        <p style={{ ...textStyles.sectionSubtitle, margin: 0 }}>
          This case has no goods lines yet. Relief is claimed against a goods line.
        </p>
      </div>
    )
  }

  return (
    <div style={section}>
      {lines.length > 1 && (
        <div style={{ maxWidth: '620px', marginBottom: spacing[4] }}>
          <p style={labelStyle}>Goods line</p>
          <select
            value={lineId}
            onChange={e => setLineId(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
            aria-label="Goods line"
          >
            {lines.map(l => (
              <option key={l.id} value={l.id}>
                {l.cn_code ?? 'No code'} · {l.product_description || l.description || 'No description'}
                {l.origin_country ? ` · from ${l.origin_country}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {lineId && <LineRelief key={lineId} case_={case_} lineId={lineId} />}
    </div>
  )
}

export function CbamCarbonRelief({ cases }: { cases: CbamCaseSummary[] }) {
  return (
    <div>
      <CbamCasePicker
        cases={cases}
        emptyMessage="There are no cases yet. Relief is claimed against a case, so start one from Cases first."
      >
        {c => <CaseRelief case_={c} />}
      </CbamCasePicker>
    </div>
  )
}
