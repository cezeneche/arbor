// A supplier's earlier emissions figures beside the one on a goods line. Pure.
//
// Nucleos compares them (the B2 rule: more than 30% from the installation's
// average, once there are at least three earlier figures) and says whether the
// line is flagged. Nothing is worked out here: a figure in line is described
// by the threshold it stayed within, not by a deviation computed a second time.

export interface SupplierHistoryResponse {
  installation_id?: string | null
  current_see_tco2e_per_t?: string | null
  threshold_pct?: string | null
  min_history?: number | null
  history?: { reporting_period?: string | null; see_tco2e_per_t?: string | null; method?: string | null }[]
  rolling_mean?: string | null
  deviation_pct?: string | null
  flagged?: boolean | null
  note?: string | null
}

export interface PresentedSupplierHistory {
  available: boolean
  flagged: boolean
  /** The line's own figure, when the supplier gave one. */
  current: string | null
  verdict: string
  rows: { period: string; value: string; source: string }[]
}

function intensity(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return `${n.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tCO₂e per tonne`
}

function percent(fraction: string | null | undefined): string | null {
  if (fraction === null || fraction === undefined || fraction === '') return null
  const n = Number(fraction)
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : null
}

const SOURCE: Record<string, string> = { actual: 'Supplier’s figure', estimated: 'Supplier’s estimate' }

export function presentSupplierHistory(body: SupplierHistoryResponse | null): PresentedSupplierHistory {
  if (!body) {
    return { available: false, flagged: false, current: null, verdict: 'No history could be found for these goods.', rows: [] }
  }

  const rows = (body.history ?? []).map(h => ({
    period: h.reporting_period ?? '—',
    value: intensity(h.see_tco2e_per_t) ?? '—',
    source: SOURCE[h.method ?? ''] ?? 'Supplier’s figure',
  }))
  const current = intensity(body.current_see_tco2e_per_t)
  const average = intensity(body.rolling_mean)
  const needed = body.min_history ?? 3
  const flagged = body.flagged === true

  let verdict: string
  if (body.note) {
    verdict = body.note
  } else if (current === null) {
    verdict =
      'These goods have no supplier figure yet, so there is nothing to compare with the installation’s earlier figures.'
  } else if (rows.length === 0) {
    verdict = 'This is the first figure from this installation for these goods.'
  } else if (flagged) {
    verdict =
      `This figure is ${percent(body.deviation_pct) ?? 'well'} away from the average of this installation’s earlier ` +
      `figures (${average}). Check it with the supplier before relying on it.`
  } else if (average === null || rows.length < needed) {
    verdict =
      `${rows.length === 1 ? 'One earlier figure' : `${rows.length} earlier figures`} from this installation. ` +
      `At least ${needed} are needed before this figure can be compared.`
  } else {
    verdict = `Within ${percent(body.threshold_pct) ?? '30%'} of the average of this installation’s earlier figures (${average}).`
  }

  return { available: !body.note, flagged, current, verdict, rows }
}
