import { fingerprintGroup, planDpRelease, mergeReleases } from '../dp-release-ledger'
import type { DPGroupInput } from '@/lib/brain/types'

const group = (key: string, values: number[]): DPGroupInput => ({
  key,
  values,
  low: 0,
  high: 1000,
})

describe('fingerprintGroup', () => {
  it('is stable for the same data', () => {
    expect(fingerprintGroup(group('g1', [1, 2, 3]))).toBe(fingerprintGroup(group('g1', [1, 2, 3])))
  })

  // Rows come back from the database in whatever order the planner chose, and an
  // order change is not new data.
  it('ignores the order the values arrived in', () => {
    expect(fingerprintGroup(group('g1', [3, 1, 2]))).toBe(fingerprintGroup(group('g1', [1, 2, 3])))
  })

  it('changes when a value changes', () => {
    expect(fingerprintGroup(group('g1', [1, 2, 3]))).not.toBe(
      fingerprintGroup(group('g1', [1, 2, 4])),
    )
  })

  it('changes when a contributor joins', () => {
    expect(fingerprintGroup(group('g1', [1, 2, 3]))).not.toBe(
      fingerprintGroup(group('g1', [1, 2, 3, 4])),
    )
  })

  it('changes when the bounds change', () => {
    expect(fingerprintGroup({ ...group('g1', [1, 2]), high: 500 })).not.toBe(
      fingerprintGroup(group('g1', [1, 2])),
    )
  })
})

describe('planDpRelease', () => {
  const g1 = group('steel__ENERGY__kwh__mj', [10, 20, 30])
  const g2 = group('steel__PRODUCTION__tonnes__kg', [5, 6, 7])

  it('asks for a draw when nothing has been released', () => {
    const plan = planDpRelease([g1, g2], 1, [])
    expect(plan.toRelease).toEqual([g1, g2])
    expect(plan.replayed).toEqual([])
  })

  // The defect: repeated calls drew fresh noise over identical data, so averaging
  // the answers recovered the true figure and the privacy guarantee dissolved.
  it('replays the existing release when the data has not changed', () => {
    const ledger = [
      {
        groupKey: g1.key,
        epsilon: 1,
        inputFingerprint: fingerprintGroup(g1),
        suppressed: false,
        n: 3,
        dpMean: 21.4,
        dpCount: 3.1,
      },
    ]
    const plan = planDpRelease([g1, g2], 1, ledger)
    expect(plan.toRelease).toEqual([g2])
    expect(plan.replayed).toEqual([
      { key: g1.key, suppressed: false, n: 3, dp_mean: 21.4, dp_count: 3.1, epsilon: 1, reason: null },
    ])
  })

  it('replays a suppression too, so probing cannot reveal the floor being crossed', () => {
    const ledger = [
      {
        groupKey: g1.key,
        epsilon: 1,
        inputFingerprint: fingerprintGroup(g1),
        suppressed: true,
        n: 3,
        dpMean: null,
        dpCount: null,
      },
    ]
    const plan = planDpRelease([g1], 1, ledger)
    expect(plan.toRelease).toEqual([])
    expect(plan.replayed[0].suppressed).toBe(true)
  })

  // A different epsilon is a different privacy setting, so it is a different
  // release — but it must not be reachable by simply nudging the parameter to get
  // a second sample of the same data, which is why the ledger keys on it.
  it('treats a different epsilon as a separate release', () => {
    const ledger = [
      {
        groupKey: g1.key,
        epsilon: 1,
        inputFingerprint: fingerprintGroup(g1),
        suppressed: false,
        n: 3,
        dpMean: 21.4,
        dpCount: 3.1,
      },
    ]
    expect(planDpRelease([g1], 2, ledger).toRelease).toEqual([g1])
  })

  it('draws again once the underlying data genuinely changes', () => {
    const ledger = [
      {
        groupKey: g1.key,
        epsilon: 1,
        inputFingerprint: fingerprintGroup(g1),
        suppressed: false,
        n: 3,
        dpMean: 21.4,
        dpCount: 3.1,
      },
    ]
    const grown = group(g1.key, [10, 20, 30, 40])
    expect(planDpRelease([grown], 1, ledger).toRelease).toEqual([grown])
  })
})

describe('mergeReleases', () => {
  const g1 = group('a', [1])
  const g2 = group('b', [2])

  it('returns releases in the caller’s group order regardless of origin', () => {
    const replayed = [{ key: 'b', suppressed: false, n: 1, dp_mean: 2, dp_count: 1 }]
    const fresh = [{ key: 'a', suppressed: false, n: 1, dp_mean: 1, dp_count: 1 }]
    expect(mergeReleases([g1, g2], replayed, fresh).map(r => r.key)).toEqual(['a', 'b'])
  })

  it('drops a group the brain did not answer for rather than inventing one', () => {
    expect(mergeReleases([g1, g2], [], [{ key: 'a', suppressed: false, n: 1 }])).toHaveLength(1)
  })
})
