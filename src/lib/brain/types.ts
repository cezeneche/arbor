// Wire contract mirror for the brain's calibration endpoint. Kept in sync with
// brain/app/models.py by hand — the two are the two ends of one contract.

export interface LabelSample {
  group: string
  score: number
  correct: boolean
}

export interface ReliabilityBin {
  bin_lower: number
  bin_upper: number
  mean_predicted: number
  empirical_accuracy: number
  count: number
}

export interface CalibrationMap {
  method: string
  x: number[]
  y: number[]
}

export interface GroupCalibration {
  group: string
  n: number
  brier: number | null
  ece: number | null
  reliability: ReliabilityBin[]
  calibration_map: CalibrationMap
  sufficient: boolean
}

export interface CalibrationFitResponse {
  groups: GroupCalibration[]
  fitted_at: string
}

// ── Entity-resolution baseline scoring ───────────────────────────

export interface ResolutionEntityName {
  id: string
  /** Already normalised by the blocking layer; the brain scores it as-is. */
  normalised: string
}

export interface ResolutionPair {
  a: string
  b: string
}

export type ResolutionDecision = 'match' | 'review' | 'distinct'

export interface ScoredPair {
  a: string
  b: string
  similarity: number
  decision: ResolutionDecision
}

export interface ResolutionScoreResponse {
  scores: ScoredPair[]
}

// ── Schema inference from field co-occurrence ────────────────────

export interface SchemaFieldPair {
  a: string
  b: string
  mi: number
}

export interface SchemaInferResponse {
  core: string[]
  groups: string[][]
  noise: string[]
  pairs: SchemaFieldPair[]
}

// ── Algebraic constraints + MaxEnt completion ────────────────────

export interface ConstraintRecordInput {
  id: string
  sector?: string | null
  fields: Record<string, number | null>
}

export interface ConstraintViolation {
  field: string
  type: string
  severity: string
  message: string
}

export interface ConstraintCompletion {
  field: string
  value: number
  method: string
  determined: boolean
  entropy_bits: number
  low?: number | null
  high?: number | null
}

export interface ConstraintRecordResult {
  id: string
  violations: ConstraintViolation[]
  completions: ConstraintCompletion[]
}

export interface ConstraintCheckResponse {
  results: ConstraintRecordResult[]
}

// ── Graph flow consistency ───────────────────────────────────────

export interface FlowNodeInput {
  id: string
  supply?: number
  demand?: number
}

export interface FlowEdgeInput {
  source: string
  target: string
  quantity: number
}

export interface FlowClaimInput {
  ref: string
  claimant: string
  quantity?: number
  capacity?: number | null
}

export interface ConservationAnomaly {
  node: string
  type: string
  available: number
  used: number
  message: string
}

export interface DoubleCountAnomaly {
  ref: string
  type: string
  claimants: string[]
  total: number
  capacity: number | null
  message: string
}

export interface FlowCheckResponse {
  conservation: ConservationAnomaly[]
  double_counting: DoubleCountAnomaly[]
}

// ── Differential privacy on cross-tenant aggregates ─────────────

export interface DPGroupInput {
  key: string
  /** One value per aggregation unit (canonical entity) in this group. */
  values: number[]
  low: number
  high: number
}

export interface DPRelease {
  key: string
  suppressed: boolean
  n: number
  dp_mean?: number | null
  dp_count?: number | null
  epsilon?: number | null
  bounds?: number[] | null
  reason?: string | null
}

export interface DPBenchmarkResponse {
  releases: DPRelease[]
}
