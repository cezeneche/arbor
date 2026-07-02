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

// ── Entity-resolution baseline scoring (Upgrade 5) ───────────────────────────

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
