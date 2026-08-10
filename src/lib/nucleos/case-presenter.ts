// Turning a Nucleos case into the few strings a row actually shows.
//
// Kept pure and separate from the page so the decisions here are testable —
// particularly the exposure rule, which is the one figure on this screen that
// can mislead.

import type { CbamCaseSummary } from './cases-client'

export interface CasePresentation {
  id: string
  /** Who the case is for, falling back to the EORI when no name is held. */
  importer: string
  /** "Q1 2027" or "2027", or "Period not set". */
  period: string
  sector: string
  origin: string
  mass: string
  /** Formatted exposure, or an em-dash when none can honestly be shown. */
  exposure: string
  /** Present only when the exposure is withheld — says what is missing. */
  exposureNote: string | null
  status: string
  href: string
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function presentCase(c: CbamCaseSummary): CasePresentation {
  const period =
    c.reporting_year == null
      ? 'Period not set'
      : c.reporting_quarter == null
        ? String(c.reporting_year)
        : `Q${c.reporting_quarter} ${c.reporting_year}`

  const mass =
    typeof c.total_net_mass_kg === 'number' && c.total_net_mass_kg > 0
      ? `${(c.total_net_mass_kg / 1000).toLocaleString('en-GB', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} t`
      : '—'

  // The exposure rule, in one place. A figure whose inputs are placeholder-derived
  // does not render as a number: it renders an em-dash and names what is missing.
  // A zero here would read as "no exposure", which is the opposite of "unknown".
  const hasExposure =
    typeof c.estimated_liability_gbp === 'number' &&
    Number.isFinite(c.estimated_liability_gbp)

  return {
    id: c.id,
    importer: c.importer_name?.trim() || c.importer_eori?.trim() || 'Unknown importer',
    period,
    sector: c.sector ? titleCase(c.sector) : '—',
    origin: c.origin_country?.trim() || '—',
    mass,
    exposure: hasExposure
      ? `£${(c.estimated_liability_gbp as number).toLocaleString('en-GB', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`
      : '—',
    exposureNote: hasExposure
      ? null
      : (c.estimated_liability_unavailable?.detail ??
         'No published rate — exposure cannot be shown'),
    status: c.status ? titleCase(c.status) : 'Draft',
    href: `/cbam/${encodeURIComponent(c.id)}`,
  }
}

/**
 * The section's headline total.
 *
 * Only sums cases that have a figure, and says how many it could not include.
 * Silently summing the ones that resolve would present a partial total as a
 * complete one — the same error as a short declaration, on the screen a user
 * looks at first.
 */
export function summariseExposure(cases: CbamCaseSummary[]): {
  total: string
  withheldCount: number
  note: string | null
} {
  const withFigures = cases.filter(
    c => typeof c.estimated_liability_gbp === 'number' && Number.isFinite(c.estimated_liability_gbp),
  )
  const withheldCount = cases.length - withFigures.length
  const sum = withFigures.reduce((acc, c) => acc + (c.estimated_liability_gbp as number), 0)

  if (withFigures.length === 0) {
    return {
      total: '—',
      withheldCount,
      note:
        cases.length === 0
          ? null
          : 'No exposure can be shown yet — HMRC has not published the rates these cases need.',
    }
  }

  return {
    total: `£${sum.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
    withheldCount,
    note:
      withheldCount > 0
        ? `Excludes ${withheldCount} case${withheldCount === 1 ? '' : 's'} with no published rate.`
        : null,
  }
}
