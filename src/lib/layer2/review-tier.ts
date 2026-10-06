// The tier a reviewed document is saved at. The review screen shows it before
// saving and the confirm route writes it, and both call this with the same
// inputs, so what the reviewer is shown is what they get. They used to decide
// it separately, and the screen left out the organisation name and the
// reporting-period end, so an expired certificate showed Verified and saved
// Declared.
//
// A CBAM document is judged on its goods lines against the CBAM vocabulary;
// every other document goes through the certification policy.
import { certifyTier } from './certification-policy'
import { cbamCompulsoryFieldsPresent } from '@/lib/nucleos/cbam-fields'

export interface ReviewTierInput {
  documentType: string
  cbam: boolean
  /** Whether anything was read from the document at all. */
  hasExtraction: boolean
  /** What extraction read, by field. */
  extracted: Map<string, string | null>
  /** What the reviewer confirmed, by field. */
  confirmed: Map<string, string>
  /** The text each extracted value was read from. */
  sourceText: Map<string, string | null>
  /** The organisation's registered name. */
  entityName: string
  /** The period ends of the records being saved (ISO strings). */
  recordPeriodEnds: readonly string[]
}

/** The latest period end among the records, which the policy checks certificates against. */
export function reportingPeriodEnd(periodEnds: readonly string[]): Date | undefined {
  const ends = periodEnds.map(p => Date.parse(p)).filter(Number.isFinite)
  return ends.length ? new Date(Math.max(...ends)) : undefined
}

export function reviewTier(input: ReviewTierInput): 'A' | 'B' {
  if (input.cbam) {
    return input.hasExtraction && cbamCompulsoryFieldsPresent(input.confirmed, input.sourceText) ? 'A' : 'B'
  }
  return certifyTier({
    documentType: input.documentType,
    extracted: input.extracted,
    confirmed: input.confirmed,
    hasExtraction: input.hasExtraction,
    entityName: input.entityName,
    reportingPeriodEnd: reportingPeriodEnd(input.recordPeriodEnds),
    sourceText: input.sourceText,
  }).tier
}
