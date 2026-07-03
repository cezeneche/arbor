import {
  planEntityLinks,
  pairKey,
  RESOLUTION_METHOD,
  type ExistingLink,
} from '../link-planner'
import type { ScoredPair } from '@/lib/brain/types'

// Upgrade 5 — the planner decides which scored pairs become persisted candidate
// links. Two rules matter: only match/review pairs are persisted (distinct is
// dropped), and a human decision is never resurfaced — a CONFIRMED or REJECTED
// link is left alone on re-runs, only PENDING links refresh. Pure — the cron
// route wraps DB reads/writes around this. Existing-link keys are built with
// pairKey so the test can never drift from the implementation's key format.

function scored(
  a: string,
  b: string,
  similarity: number,
  decision: ScoredPair['decision'],
): ScoredPair {
  return { a, b, similarity, decision }
}

describe('planEntityLinks', () => {
  it('creates PENDING candidates for match and review pairs', () => {
    const { toCreate, toUpdate } = planEntityLinks(
      [scored('a', 'b', 0.9, 'match'), scored('c', 'd', 0.7, 'review')],
      new Map(),
    )
    expect(toUpdate).toEqual([])
    expect(toCreate).toHaveLength(2)
    expect(toCreate[0]).toMatchObject({
      entityAId: 'a',
      entityBId: 'b',
      similarity: 0.9,
      suggestedDecision: 'match',
      method: RESOLUTION_METHOD,
    })
  })

  it('drops distinct pairs entirely', () => {
    const { toCreate, toUpdate } = planEntityLinks([scored('a', 'b', 0.2, 'distinct')], new Map())
    expect(toCreate).toEqual([])
    expect(toUpdate).toEqual([])
  })

  it('orders each pair a<b regardless of the scored order', () => {
    const { toCreate } = planEntityLinks([scored('z', 'a', 0.9, 'match')], new Map())
    expect(toCreate[0]).toMatchObject({ entityAId: 'a', entityBId: 'z' })
  })

  it('refreshes an existing PENDING link rather than duplicating it', () => {
    const existing = new Map<string, ExistingLink>([
      [pairKey('a', 'b'), { id: 'link-1', status: 'PENDING' }],
    ])
    const { toCreate, toUpdate } = planEntityLinks([scored('a', 'b', 0.95, 'match')], existing)
    expect(toCreate).toEqual([])
    expect(toUpdate).toEqual([{ id: 'link-1', similarity: 0.95, suggestedDecision: 'match' }])
  })

  it('never resurfaces a human-decided link (CONFIRMED or REJECTED are left alone)', () => {
    const existing = new Map<string, ExistingLink>([
      [pairKey('a', 'b'), { id: 'l1', status: 'CONFIRMED' }],
      [pairKey('c', 'd'), { id: 'l2', status: 'REJECTED' }],
    ])
    const { toCreate, toUpdate } = planEntityLinks(
      [scored('a', 'b', 0.99, 'match'), scored('c', 'd', 0.88, 'match')],
      existing,
    )
    expect(toCreate).toEqual([])
    expect(toUpdate).toEqual([])
  })
})
