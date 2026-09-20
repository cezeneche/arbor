// Layer 2 — the trust tier a confirmed document is certified at. Pure: no DB,
// no AI.
//
// There is one policy, and it is the admissibility spec: the same rules
// extraction applies (compulsory fields, estimated reads, expired certificates,
// short commodity codes, documents with no spec at all), run over the effective
// document — the extraction with the reviewer's corrections applied on top.
//
// Confirmation used to re-derive the tier with a narrower check that looked at
// compulsory-field presence only. That check promoted an estimated meter read
// to Verified the moment a person confirmed the number, and promoted any
// document type with no spec because its compulsory set was empty. A person
// confirming a figure establishes that the figure is what the document says,
// not how it was measured.
//
// Confidence plays no part here. Low confidence routes a field to review, and
// review is what this runs after.
import { evaluateAdmissibility } from '@/lib/extraction/admissibility'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { fieldLabel } from '@/lib/layer3/field-label'
import type { ExtractedFieldResult } from '@/lib/extraction/types'

export interface CertificationInput {
  documentType: string
  /** What the extraction found. null/'' means it found nothing for the field. */
  extracted: ReadonlyMap<string, string | null>
  /** Field name → the value the reviewer confirmed or corrected. */
  confirmed: ReadonlyMap<string, string>
  /** False when nothing was read from a document at all. */
  hasExtraction: boolean
  entityName: string
  /** End of the period the confirmed records cover. */
  reportingPeriodEnd?: Date
  /**
   * Field name → the text each value was read from. Verified claims a record
   * can be confirmed against its document, and the admissibility spec does not
   * look at source text, so without this a document whose values arrived with
   * nothing to confirm them against was certified Verified. Omitted by callers
   * that have no extraction to judge.
   */
  sourceText?: ReadonlyMap<string, string | null>
}

export interface CertificationResult {
  tier: 'A' | 'B'
  /** Why the document is not Verified. Empty when it is. */
  reasons: string[]
}

/**
 * The compulsory fields this document is certified on that have no text behind
 * them. A value the reviewer supplied is theirs to stand behind and is not
 * asked for source text; a value the extraction produced must carry the text it
 * came from, or Verified would assert something nobody can check.
 */
function unconfirmableCompulsoryFields(input: CertificationInput): string[] {
  if (!input.sourceText) return []
  return (DOCUMENT_FIELD_DEFINITIONS[input.documentType] ?? [])
    .filter(def => def.admissibility === 'compulsory')
    .filter(def => !input.confirmed.has(def.name))
    .filter(def => !(input.sourceText!.get(def.name) ?? '').trim())
    .map(def => def.name)
}

export function certifyTier(input: CertificationInput): CertificationResult {
  if (!input.hasExtraction) {
    return { tier: 'B', reasons: ['Nothing was read from a supporting document.'] }
  }

  const effective = new Map<string, string | null>(input.extracted)
  for (const [name, value] of input.confirmed) {
    effective.set(name, value.trim() === '' ? null : value)
  }

  const fields: ExtractedFieldResult[] = [...effective].map(([fieldName, rawValue]) => ({
    fieldName,
    rawValue,
    rawUnit: null,
    sourceText: '',
    // Reviewed: confidence has done its job by routing the field here.
    confidenceScore: 1,
    flagged: false,
    flagReason: null,
  }))

  const result = evaluateAdmissibility(
    input.documentType,
    fields,
    input.entityName,
    input.reportingPeriodEnd,
  )

  if (result.tier === 'A') {
    const unconfirmable = unconfirmableCompulsoryFields(input)
    if (unconfirmable.length === 0) return { tier: 'A', reasons: [] }
    return {
      tier: 'B',
      reasons: unconfirmable.map(
        name =>
          `We could not show the text ${fieldLabel(name).toLowerCase()} was read from, ` +
          'so it cannot be confirmed against the document.',
      ),
    }
  }

  const reasons = result.flags.filter(f => f.severity === 'CRITICAL').map(f => f.message)
  if (reasons.length === 0) {
    reasons.push('This kind of document has no admissibility specification to verify it against.')
  }
  return { tier: 'B', reasons }
}
