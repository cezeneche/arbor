// Upgrade 12 — correction-agency reinforcement. Pure: no DB, no React.
//
// Skitka's automation-bias failure mode is users deferring to the machine. The
// antidote the plan calls for is reflecting the user's own vigilance back to
// them: every value they corrected is proof their review mattered — and it did,
// because each correction is a GroundTruthLabel that feeds the calibration
// pipeline (Upgrade 1). This counts those decisions for that surface.

import type { GroundTruthSource } from '@prisma/client'

export interface ReviewLabel {
  source: GroundTruthSource
  wasCorrect: boolean
}

export interface CorrectionSummary {
  /** Total AI-extracted fields the user has reviewed. */
  reviewed: number
  /** Reviewed fields the user accepted unchanged. */
  confirmed: number
  /** Reviewed fields the user changed or cleared — caught by human vigilance. */
  corrected: number
}

export function summariseCorrections(labels: ReviewLabel[]): CorrectionSummary {
  let confirmed = 0
  let corrected = 0
  for (const l of labels) {
    if (l.source === 'REVIEW_CORRECTED') corrected++
    else if (l.source === 'REVIEW_CONFIRMED') confirmed++
  }
  return { reviewed: labels.length, confirmed, corrected }
}
