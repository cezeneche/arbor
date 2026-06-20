// Core 1 — Questionnaire pre-fill engine.
// Type model only. No DB, no AI, no side effects. Shared by the pure prefill
// function (Layer 3 logic), the templates, the API loader, and the UI.

import type { DataDomain, TrustTier } from '@/lib/constants'

/**
 * How a question maps onto stored DataRecords.
 *  - direct:     one canonical stored record answers it (e.g. a carbon footprint
 *                report's total_co2e). Filled with that value + its tier.
 *  - assemble:   many same-(domain, field, unit) records combine by transparent
 *                sum (e.g. four quarterly electricity bills → annual kWh). Never
 *                applies a factor or a unit conversion that changes meaning.
 *  - collection: list contributing records for the customer's tool to combine,
 *                used where a real sustainability calculation would be required
 *                (e.g. kWh → tCO2e). Arbor never performs that calculation.
 */
export type QuestionMode = 'direct' | 'assemble' | 'collection'

export interface QuestionDefinition {
  /** Stable id, unique within the template. */
  id: string
  /** Plain English question text shown to the user. */
  text: string
  /** Optional grouping label, e.g. a framework section heading. */
  section?: string
  mode: QuestionMode
  /** Domain of the stored records that answer this question. */
  domain: DataDomain
  /** fieldName of the stored records that answer this question. */
  fieldName: string
  /**
   * The unit the answer should be expressed in. For direct/assemble the Layer-3
   * loader converts stored SI records to this unit before the pure prefill runs,
   * so the pure function only ever sums identical units. Omit for collection.
   */
  unit?: string
  /** Optional helper text shown beneath the question in the UI. */
  guidance?: string
}

export interface QuestionnaireTemplate {
  /** URL slug. */
  id: string
  name: string
  framework: string
  description: string
  /** 'available' templates can be pre-filled; 'stub' are listed but not yet built. */
  status: 'available' | 'stub'
  questions: QuestionDefinition[]
}

/** A single contributing stored record, surfaced on an answer for provenance. */
export interface PrefillRecordRef {
  recordId: string
  value: number
  unit: string
  trustTier: TrustTier
  periodStart: string
  periodEnd: string
}

export interface PrefilledAnswer {
  questionId: string
  questionText: string
  section?: string
  mode: QuestionMode
  /** 'answered' when stored records covered it; 'gap' when nothing matched. */
  status: 'answered' | 'gap'
  /** The assembled/selected value, or null for gaps and collection answers. */
  value: number | null
  unit: string | null
  /** Worst contributing tier (A→B→C), or null for a gap. */
  trustTier: TrustTier | null
  /** ids of the stored records that contributed to this answer. */
  sourceRecordIds: string[]
  contributingCount: number
  /** Human-readable provenance note, e.g. "Σ of 4 records". */
  note: string | null
  /** For collection answers: the records the customer's tool must combine. */
  contributingRecords: PrefillRecordRef[]
}
