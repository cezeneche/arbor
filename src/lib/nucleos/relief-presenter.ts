// Carbon price relief on one goods line, as the importer sees it. Pure.
//
// Three questions: can relief be claimed here, and under which scheme; which
// claim counts on the return; and does a verifier's statement stand behind it.
// Only the newest claim can count — claiming again replaces the earlier claim,
// which is how a mistyped price is corrected — and only once its verifier's
// statement is attached. Nucleos applies the same rule to the return.

import { cprDisplay } from './cpr-display'
import type { QualifyingSchemes, ReliefClaim } from './relief-client'

export interface SchemeChoice {
  eligible: boolean
  /** Why relief cannot be claimed, when it cannot. */
  message: string | null
  /** The confirmed schemes, each with the currency its price is quoted in. */
  options: { name: string; currency: string | null }[]
}

export function schemeChoice(origin: string | null, schemes: QualifyingSchemes | null): SchemeChoice {
  if (!origin) {
    return {
      eligible: false,
      message:
        'These goods have no country of origin recorded, and relief depends on which scheme the carbon price was paid under.',
      options: [],
    }
  }
  const options = (schemes?.schemes ?? [])
    .filter(s => s.status === 'confirmed')
    .map(s => ({ name: s.name, currency: s.currency }))
  if (options.length === 0) {
    return {
      eligible: false,
      message:
        schemes?.warning ??
        `Goods from ${origin} are not covered by a carbon pricing scheme the UK recognises, so no relief can be claimed against them.`,
      options: [],
    }
  }
  return { eligible: true, message: null, options }
}

export interface ReliefStatementRef {
  id: string
  sha256: string
  verifierName: string
  verifierAccreditation: string
}

export interface PresentedReliefClaim {
  id: string
  /** The newest claim: the only one that can count. */
  latest: boolean
  /** True when the return carries it: the newest claim, with its statement attached. */
  counts: boolean
  status: 'Counts on the return' | 'Not counted until the verifier’s statement is attached' | 'Replaced by a later claim'
  amount: string
  scheme: string
  /** The figures the relief was worked out from. */
  basis: string
  summary: string
  qualifications: string[]
  statement: { attached: boolean; label: string; statementId: string | null }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function basis(claim: ReliefClaim): string {
  const emissions = num(claim.verified_emissions_tco2e)
  const price = num(claim.carbon_price_local_currency)
  const rate = num(claim.exchange_rate_to_gbp)
  const currency = claim.local_currency_code ?? ''
  const parts = [
    emissions === null ? '— tCO₂e' : `${emissions.toLocaleString('en-GB', { maximumFractionDigits: 3 })} tCO₂e`,
    price === null
      ? 'an unrecorded price'
      : `${price.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency} per tCO₂e`,
  ]
  const date = longDate(claim.exchange_rate_date)
  const conversion = rate === null ? '' : `, converted at ${rate}${date ? ` (rate of ${date})` : ''}`
  return `${parts[0]} at ${parts[1]}${conversion}`
}

export function presentReliefClaims(
  claims: readonly ReliefClaim[],
  statements: readonly ReliefStatementRef[],
): PresentedReliefClaim[] {
  const byHash = new Map(statements.map(s => [s.sha256, s]))
  const newestFirst = [...claims].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  return newestFirst.map((claim, index) => {
    const hash = claim.verification_document_hash ?? null
    const held = hash ? byHash.get(hash) : undefined
    const display = cprDisplay({
      reliefAmount: num(claim.cpr_amount_gbp) ?? 0,
      reliefCurrency: 'GBP',
      verificationStatus: hash ? 'VERIFIED' : 'UNVERIFIED',
      capped: claim.cpr_capped === true,
      uncappedAmount: num(claim.cpr_raw_gbp),
    })
    const latest = index === 0
    const counts = latest && hash !== null
    return {
      id: claim.id,
      latest,
      counts,
      status: counts
        ? 'Counts on the return'
        : latest
          ? 'Not counted until the verifier’s statement is attached'
          : 'Replaced by a later claim',
      amount: display.amount,
      scheme: claim.qualifying_scheme_name ?? '—',
      basis: basis(claim),
      summary: display.summary,
      qualifications: display.qualifications,
      statement: !hash
        ? { attached: false, label: 'No verifier’s statement yet', statementId: null }
        : held
          ? {
              attached: true,
              label: `Verifier’s statement from ${held.verifierName} (${held.verifierAccreditation})`,
              statementId: held.id,
            }
          : { attached: true, label: 'Verifier’s statement recorded', statementId: null },
    }
  })
}

/** The one thing the line needs next. */
export function reliefNextStep(rows: readonly PresentedReliefClaim[]): 'claim' | 'statement' | 'none' {
  if (rows.length === 0) return 'claim'
  return rows[0].statement.attached ? 'none' : 'statement'
}
