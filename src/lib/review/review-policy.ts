// Batched review policy. Pure: no DB, no AI, no side effects.
// Decides which documents may be auto-accepted (low-stakes) versus which must
// still block on per-document review (high-stakes), and the maths behind the
// weekly review digest.

import { isCbamRelevant } from '@/lib/nucleos/cbam-relevance'

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

/**
 * How many values a document adds to the weekly digest. A document awaiting
 * review counts the fields it was unsure of. An auto-accepted one counts every
 * figure it saved: none was checked, and checking them is what makes them
 * Verified. It has no flags by construction, so counting flags left it out.
 */
export function digestFieldCount(doc: {
  autoAccepted: boolean
  fields: readonly { fieldName: string; rawValue: string | null; flagged: boolean }[]
}): number {
  if (doc.autoAccepted) {
    return doc.fields.filter(f => NUMERIC_FIELDS.has(f.fieldName) && (f.rawValue ?? '').trim() !== '').length
  }
  return doc.fields.filter(f => f.flagged).length
}

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

// PERIOD DERIVATION
// A record's period must be a deterministic function of the DOCUMENT, never of
// when it happened to be uploaded.
//
// It used to fall back to `now - 365 days → now` at millisecond precision. 12 of
// the 20 record-producing document types carry no period_start/period_end, so
// that fallback was the majority case: the same customs declaration uploaded
// twice produced two different periods, supersession (which matches on exact
// entity+domain+fieldName+period) missed, and both records stayed active. A
// silent double count — precisely what the duplication check exists to prevent.
//
// Resolution order:
//   1. explicit period fields
//   2. the document type's own activity date → that whole day
//   3. a year field → that whole calendar year
//   4. a day-truncated trailing window, so it is at least stable within a day

/**
 * When the activity happened, per document type — deliberately the activity date
 * rather than the paperwork date. A freight invoice is anchored to the shipment,
 * not to when it was billed; a carbon footprint report to its data year, not its
 * publication date. First match wins.
 */
const PERIOD_ANCHOR_FIELDS: Record<string, string[]> = {
  FUEL_RECEIPT: ['purchase_date'],
  MATERIAL_INTAKE: ['delivery_date'],
  DELIVERY_NOTE: ['delivery_date'],
  // declaration_date is the generic extractor's name; a Nucleos (CBAM)
  // extraction has none and dates the import instead. Without the CBAM names a
  // customs declaration fell through to the review date, and its case to the
  // quarter it happened to be reviewed in.
  CUSTOMS_DECLARATION: ['declaration_date', 'import_date', 'invoice_date'],
  BILL_OF_LADING: ['date_of_issue'],
  SUPPLIER_INVOICE: ['import_date', 'invoice_date'],
  PURCHASE_ORDER: ['po_date'],
  FREIGHT_INVOICE: ['shipment_date', 'invoice_date'],
  CROP_YIELD_RECORD: ['harvest_date'],
  FERTILISER_RECORD: ['application_date'],
  LAND_USE_CERTIFICATE: ['issue_date'],
  PRODUCT_CERTIFICATE: ['issue_date'],
  ENVIRONMENTAL_CERTIFICATE: ['issue_date'],
  BILL_OF_MATERIALS: ['effective_date'],
  // After production_period_*: a Nucleos extraction of a CBAM declaration
  // carries the CBAM vocabulary's dates instead.
  CBAM_DECLARATION: ['import_date', 'invoice_date'],
}

/** Year-valued fields naming the period the document's figures describe. */
const PERIOD_ANCHOR_YEAR_FIELDS: Record<string, string[]> = {
  CARBON_FOOTPRINT_REPORT: ['data_year'],
  EMISSIONS_FACTOR_DOC: ['reporting_year'],
  RENEWABLE_CERTIFICATE: ['vintage_year'],
  ESG_REPORT: ['reporting_year'],
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : new Date(ms)
}

const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))

const endOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))

export interface DerivePeriodOptions {
  now?: Date
  /** Selects the anchor date field. Omit and only steps 1 and 4 apply. */
  documentType?: string
}

/**
 * The period the document itself states or dates, or null when it does
 * neither. Steps 1-3 of the resolution order, with no fallback.
 */
export function documentPeriod(
  values: Record<string, string | null | undefined>,
  opts: Pick<DerivePeriodOptions, 'documentType'> = {},
): { periodStart: Date; periodEnd: Date } | null {
  // 1. The document states its own period.
  const statedStart = parseDate(values['period_start'] ?? values['production_period_start'])
  const statedEnd = parseDate(values['period_end'] ?? values['production_period_end'])
  if (statedStart && statedEnd) return { periodStart: statedStart, periodEnd: statedEnd }

  // 2. A single activity date — the record covers that day.
  const anchorFields = opts.documentType ? PERIOD_ANCHOR_FIELDS[opts.documentType] ?? [] : []
  for (const field of anchorFields) {
    const anchor = parseDate(values[field])
    if (anchor) return { periodStart: startOfDay(anchor), periodEnd: endOfDay(anchor) }
  }

  // 3. A year — the record covers that calendar year.
  const yearFields = opts.documentType ? PERIOD_ANCHOR_YEAR_FIELDS[opts.documentType] ?? [] : []
  for (const field of yearFields) {
    const raw = values[field]?.trim()
    if (!raw) continue
    const year = Number(raw)
    if (!Number.isInteger(year) || year < 1900 || year > 2200) continue
    return {
      periodStart: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
      periodEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
    }
  }

  return null
}

/**
 * Whether a CBAM document still needs its import date before it is confirmed.
 *
 * A CBAM case is filed for the quarter its period ends in. derivePeriod's last
 * resort is the day of review, so an undated declaration was filed, silently,
 * for the quarter someone happened to review it in — and its records carried
 * that period too. The date is asked for at review, where the document is in
 * front of the person, rather than after the records are certified.
 */
export function missingCbamDocumentDate(
  documentType: string,
  values: Record<string, string | null | undefined>,
): boolean {
  return isCbamRelevant(documentType) && documentPeriod(values, { documentType }) === null
}

/**
 * Derive a record's period from extracted field values. Pure and deterministic:
 * given the same document, it returns the same period no matter when it runs,
 * which is what lets a re-upload supersede rather than duplicate.
 */
export function derivePeriod(
  values: Record<string, string | null | undefined>,
  opts: DerivePeriodOptions = {},
): { periodStart: Date; periodEnd: Date } {
  const now = opts.now ?? new Date()

  const stated = documentPeriod(values, opts)
  if (stated) return stated

  const statedStart = parseDate(values['period_start'] ?? values['production_period_start'])
  const statedEnd = parseDate(values['period_end'] ?? values['production_period_end'])

  // 4. Half a period is not enough to trust, so a lone stated bound falls through
  //    to the day-truncated window rather than being paired with a guess.
  const periodEnd = endOfDay(statedEnd ?? now)
  const periodStart = statedStart
    ? startOfDay(statedStart)
    : startOfDay(new Date(periodEnd.getTime() - 365 * DAY_MS))
  return { periodStart, periodEnd }
}
