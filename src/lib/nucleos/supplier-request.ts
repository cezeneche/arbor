// Asking a supplier for the emissions intensity a goods line is missing.
//
// This has its own shape, deliberately not Arbor's DataRequest. A DataRequest
// asks a supplier to share certified records it already holds, and its answer
// assembly summarises those records. This asks for a figure the supplier has
// never given anyone — an intensity in tCO2e per tonne — which then has to be
// multiplied into a mass-weighted total.
//
// Reusing DataRequest's assembly would break the moment see_tco2e_per_t needed
// multiplying by net mass, and it would break quietly: the number would still
// look like a number. A DataRequest row may still TRACK the outreach; only the
// answer-assembly logic is off limits.

/** What the supplier returns. Three fields, and no more. */
export interface SupplierSubmission {
  /** Direct specific embedded emissions, tCO2e per tonne. */
  see_tco2e_per_t: number
  production_route: string
  installation_name?: string | null
}

export interface GoodsLineContext {
  goodsLineId: string
  cnCode: string
  netMassKg: number
  goodsDescription?: string | null
  originCountry?: string | null
}

export class SupplierSubmissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierSubmissionError'
  }
}

export interface AppliedSubmission {
  goodsLineId: string
  /** The intensity as submitted, preserved for the audit trail. */
  seeTco2ePerT: number
  productionRoute: string
  installationName: string | null
  /** The mass-weighted total this implies, in kgCO2e. */
  directEmbeddedKgco2e: number
  netMassKg: number
}

/**
 * Turn a supplier's intensity into the goods line's total.
 *
 * The conversion is the whole reason this cannot reuse DataRequest: tCO2e/t × kg
 * gives kgCO2e directly, since 1 tCO2e/t is 1 kgCO2e/kg. Treating the submitted
 * figure as a total instead would overstate the line by its mass in tonnes —
 * a 24.5× error on a 24,500 kg consignment, and nothing downstream would catch
 * it because the result is still a plausible number.
 */
export function applySupplierSubmission(
  submission: SupplierSubmission,
  line: GoodsLineContext,
): AppliedSubmission {
  const intensity = Number(submission.see_tco2e_per_t)
  if (!Number.isFinite(intensity) || intensity <= 0) {
    throw new SupplierSubmissionError(
      'Specific embedded emissions must be a positive number of tCO2e per tonne.',
    )
  }
  if (!submission.production_route?.trim()) {
    throw new SupplierSubmissionError(
      'Production route is required — Annex VI defaults are differentiated by route, ' +
        'so without it the submitted figure cannot be checked against the right default.',
    )
  }
  if (!Number.isFinite(line.netMassKg) || line.netMassKg <= 0) {
    throw new SupplierSubmissionError(
      `Goods line ${line.goodsLineId} has no usable net mass, so an intensity cannot ` +
        'be converted into a total.',
    )
  }

  return {
    goodsLineId: line.goodsLineId,
    seeTco2ePerT: intensity,
    productionRoute: submission.production_route.trim(),
    installationName: submission.installation_name?.trim() || null,
    directEmbeddedKgco2e: intensity * line.netMassKg,
    netMassKg: line.netMassKg,
  }
}

/**
 * What the supplier sees on the form.
 *
 * They are not an Arbor user and have no account, so everything needed to make
 * the request comprehensible has to travel with it. A supplier who cannot tell
 * which shipment is being asked about will not answer.
 */
export function buildSupplierDisplayContext(
  line: GoodsLineContext,
  importerName: string,
  reportingPeriod?: string | null,
) {
  return {
    importer_name: importerName,
    cn_code: line.cnCode,
    goods_description: line.goodsDescription ?? null,
    net_mass_kg: line.netMassKg,
    origin_country: line.originCountry ?? null,
    reporting_period: reportingPeriod ?? null,
  }
}
