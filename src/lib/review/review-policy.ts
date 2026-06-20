// Core 4 — Batched review policy. Pure: no DB, no AI, no side effects.
// Decides which documents may be auto-accepted (low-stakes) versus which must
// still block on per-document review (high-stakes), and the maths behind the
// weekly review digest.

// High-stakes types always route to per-document review and are never silently
// declared — a wrong CBAM/customs/certificate record carries real liability.
export const CRITICAL_DOCUMENT_TYPES = new Set([
  'CBAM_DECLARATION',
  'CUSTOMS_DECLARATION',
  'PRODUCT_CERTIFICATE',
  'ENVIRONMENTAL_CERTIFICATE',
  'RENEWABLE_CERTIFICATE',
  'LAND_USE_CERTIFICATE',
  'CHAIN_OF_CUSTODY',
])

export function isCriticalDocumentType(documentType: string): boolean {
  return CRITICAL_DOCUMENT_TYPES.has(documentType)
}

/**
 * Auto-accept (write Tier B records immediately, no blocking) only when the
 * document is low-stakes AND raised no critical admissibility flags. Everything
 * else routes to the per-document review queue.
 */
export function shouldAutoAccept(documentType: string, criticalCount: number): boolean {
  return !isCriticalDocumentType(documentType) && criticalCount === 0
}

// Numeric fields that become DataRecords. Single source of truth, shared by the
// review UI and the Layer-2 auto-accept writer.
export const NUMERIC_FIELDS = new Set([
  'total_consumption_kwh', 'total_consumption_m3', 'calorific_value',
  'quantity', 'quantity_produced', 'area_hectares', 'yield_quantity',
  'quantity_mwh', 'shipment_weight', 'declared_weight', 'gross_weight',
  'embedded_emissions_tco2e', 'embedded_emissions_per_tonne', 'quantity_tonnes',
  'total_value', 'factor_value', 'total_co2e', 'quantity_m3', 'nitrogen_content_percent',
  'energy_consumption', 'energy_consumption_total', 'average_herd_size',
])

export interface ReviewQueueSummary {
  fieldCount: number
  estimatedMinutes: number
}

const SECONDS_PER_FIELD = 30

/** "N fields need ~M minutes" — the line the digest and /review header show. */
export function summariseReviewQueue(fieldCount: number): ReviewQueueSummary {
  const estimatedMinutes =
    fieldCount <= 0 ? 0 : Math.max(1, Math.round((fieldCount * SECONDS_PER_FIELD) / 60))
  return { fieldCount: Math.max(0, fieldCount), estimatedMinutes }
}

/**
 * Derive a record's period from extracted field values (mirrors the review UI):
 * prefer period_start/period_end (or production_period_*); fall back to a trailing
 * 12-month window ending now.
 */
export function derivePeriod(
  values: Record<string, string | null | undefined>,
  now: Date = new Date(),
): { periodStart: Date; periodEnd: Date } {
  const endRaw = values['period_end'] ?? values['production_period_end']
  const startRaw = values['period_start'] ?? values['production_period_start']
  const periodEnd = endRaw && !isNaN(Date.parse(endRaw)) ? new Date(endRaw) : now
  const periodStart =
    startRaw && !isNaN(Date.parse(startRaw))
      ? new Date(startRaw)
      : new Date(periodEnd.getTime() - 365 * 24 * 60 * 60 * 1000)
  return { periodStart, periodEnd }
}
