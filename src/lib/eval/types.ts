// Pre-deploy eval gate — types. Pure data shapes shared by the scoring core, the
// injectable orchestrator, and the live gate runner.
//
// A "golden case" is one document whose correct field values a human has verified
// once. Before a prompt or model change ships, the extractor is re-run against
// every golden case and scored; if a kill-signal field group regresses beyond
// tolerance versus the committed baseline, the gate fails and the change is held
// back. This is what turns "the model silently got worse" from a thing customers
// discover into a thing CI catches.

/** One human-verified expected field in a golden case. */
export interface ExpectedField {
  fieldName: string
  /** The correct value. null means the model should find nothing for this field. */
  expectedValue: string | null
}

/** One golden document with its verified expected extraction. */
export interface EvalCase {
  /** Stable identifier for this case (appears in the report). */
  id: string
  documentType: string
  /** Path to the fixture document, relative to the eval fixtures directory. */
  fixture: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
  expected: ExpectedField[]
}

/** The score for one expected field against what the extractor produced. */
export interface FieldScore {
  caseId: string
  fieldName: string
  /** Kill-signal group (supplier_identity / mass / emissions_intensity) or the raw field name. */
  group: string
  expected: string | null
  actual: string | null
  correct: boolean
}

/** Accuracy for one field group across all scored fields. */
export interface GroupAccuracy {
  group: string
  total: number
  correct: number
  /** correct / total, in [0,1]. */
  accuracy: number
  isKillSignalGroup: boolean
}

/** The committed known-good accuracy a run is gated against. */
export interface EvalBaseline {
  /** The extractor version this baseline was captured from (informational). */
  extractorVersion?: string
  /** group -> accuracy in [0,1]. */
  groups: Record<string, number>
  overall: number
}

/** Why a group failed the gate. */
export type RegressionReason = 'kill-signal-regression' | 'below-floor'

/** A group that failed the gate. */
export interface Regression {
  group: string
  baseline: number | null
  current: number
  /** baseline - current, when a baseline exists; else 0. */
  drop: number
  isKillSignalGroup: boolean
  reason: RegressionReason
}

/** The gated verdict of one eval run. */
export interface EvalReport {
  extractorVersion: string
  caseCount: number
  fieldCount: number
  overall: number
  groups: GroupAccuracy[]
  regressions: Regression[]
  /** True when no kill-signal group regressed or fell below the floor. */
  passed: boolean
}
