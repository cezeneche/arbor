// Upgrade 5 — entity-resolution link planner. Pure: no DB, no network.
//
// Given the brain's scored candidate pairs and the links that already exist,
// decide what to persist. Two invariants:
//   - Only match/review pairs are kept; distinct is dropped (not a candidate).
//   - A human's decision is final: CONFIRMED or REJECTED links are never touched,
//     so a rejected match doesn't reappear in the review queue every run. Only
//     PENDING links refresh with the latest similarity.
// Nothing here confirms a link — that is always a human action (never auto-link).

import type { ScoredPair } from '@/lib/brain/types'
import type { EntityLinkStatus } from '@prisma/client'

/** Algorithm provenance stamped on every proposed link. */
export const RESOLUTION_METHOD = 'lexical-baseline-v1'

/** The subset of an existing EntityLink the planner needs, keyed by "a b" (id-sorted). */
export interface ExistingLink {
  id: string
  status: EntityLinkStatus
}

export interface LinkCreate {
  entityAId: string
  entityBId: string
  similarity: number
  suggestedDecision: 'match' | 'review'
  method: string
}

export interface LinkUpdate {
  id: string
  similarity: number
  suggestedDecision: 'match' | 'review'
}

export interface LinkPlan {
  toCreate: LinkCreate[]
  toUpdate: LinkUpdate[]
}

/** Stable key for an unordered entity pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`
}

export function planEntityLinks(
  scored: ScoredPair[],
  existing: Map<string, ExistingLink>,
): LinkPlan {
  const toCreate: LinkCreate[] = []
  const toUpdate: LinkUpdate[] = []

  for (const s of scored) {
    if (s.decision === 'distinct') continue
    const suggestedDecision = s.decision // 'match' | 'review'

    const [entityAId, entityBId] = s.a < s.b ? [s.a, s.b] : [s.b, s.a]
    const prior = existing.get(pairKey(s.a, s.b))

    if (!prior) {
      toCreate.push({ entityAId, entityBId, similarity: s.similarity, suggestedDecision, method: RESOLUTION_METHOD })
    } else if (prior.status === 'PENDING') {
      toUpdate.push({ id: prior.id, similarity: s.similarity, suggestedDecision })
    }
    // CONFIRMED / REJECTED — a human has decided; leave it untouched.
  }

  return { toCreate, toUpdate }
}
