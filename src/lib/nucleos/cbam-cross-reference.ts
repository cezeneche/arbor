// The one place CBAM reaches into Arbor's record surface.
//
// CBAM objects — cases, consignments, goods lines, installations, declarations —
// live entirely under Emissions. They are not records and are not pushed into
// Arbor's record model.
//
// This is the single sanctioned exception, and it is required rather than
// optional: without it a user can look at a supplier and not know that supplier
// carries six figures of CBAM exposure. One line, not a panel — in-scope status,
// current exposure, and a link into the section.
//
// The exposure figure follows the same rule as everywhere else: a number whose
// inputs are placeholder-derived does not render as a number. Nucleos returns
// null with a structured reason when no HMRC rate has been published, and this
// carries that through rather than substituting a zero.

export interface CbamScopeSummary {
  inScope: boolean
  /** Null when no exposure can honestly be shown. */
  exposureGbp: number | null
  /** Why the figure is withheld, when it is. */
  exposureUnavailable: string | null
  caseCount: number
  href: string
}

export interface CbamCrossReferenceInput {
  entityId: string
  inScope: boolean
  exposureGbp?: number | null
  exposureUnavailableReason?: string | null
  caseCount?: number
}

export function buildCbamCrossReference(
  input: CbamCrossReferenceInput,
): CbamScopeSummary | null {
  // An entity with no CBAM involvement gets no line at all. A line reading
  // "not in scope" on every supplier is noise that trains people to skip it.
  if (!input.inScope) return null

  const hasFigure =
    typeof input.exposureGbp === 'number' && Number.isFinite(input.exposureGbp)

  return {
    inScope: true,
    exposureGbp: hasFigure ? (input.exposureGbp as number) : null,
    exposureUnavailable: hasFigure
      ? null
      : input.exposureUnavailableReason ?? 'No published rate — exposure cannot be shown',
    caseCount: input.caseCount ?? 0,
    href: `/emissions/cbam?entity=${encodeURIComponent(input.entityId)}`,
  }
}

/**
 * The single line, as text.
 *
 * An em-dash rather than a number when the figure is withheld: the reader must be
 * able to see that nothing is known, not read a zero as "no exposure".
 */
export function formatCbamCrossReference(summary: CbamScopeSummary): string {
  const exposure =
    summary.exposureGbp === null
      ? '—'
      : `£${summary.exposureGbp.toLocaleString('en-GB', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`

  const cases =
    summary.caseCount === 1 ? '1 CBAM case' : `${summary.caseCount} CBAM cases`

  return `In scope for CBAM · ${cases} · Exposure ${exposure}`
}
