import { NextRequest } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildCanonicalMap } from '@/lib/aggregation/entity-canonical'
import { buildDpGroups, type BenchmarkRow } from '@/lib/aggregation/dp-benchmark-input'
import { BENCHMARK_MIN_ENTITIES } from '@/lib/aggregation/sector-benchmark'
import { planDpRelease, mergeReleases } from '@/lib/aggregation/dp-release-ledger'
import { releaseDpBenchmarks } from '@/lib/brain/privacy-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'

// ε-differentially-private sector benchmarks (ADMIN). Aggregates
// Tier A records from entities that consented to benchmarking, collapses
// confirmed same-entity links into one contributor each, and asks
// the brain for a Laplace-noised mean + count per group — suppressing any group
// below the population floor. Read-only, off any write path, 503 if brain down.
// This is the monetisable corpus product that never touches an individual
// tenant's data.
const RECORD_CAP = 50000

export async function GET(req: NextRequest) {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!

  const eps = Number.parseFloat(req.nextUrl.searchParams.get('epsilon') ?? '1')
  const epsilon = Number.isFinite(eps) && eps > 0 ? Math.min(eps, 10) : 1.0

  const [records, links] = await Promise.all([
    prisma.dataRecord.findMany({
      where: { isActive: true, trustTier: 'A', entity: { allowBenchmarkAggregation: true } },
      select: {
        entityId: true,
        fieldName: true,
        value: true,
        unit: true,
        domain: true,
        entity: { select: { sector: true } },
      },
      // The cap needs an order, or "the first 50,000" is whatever the planner
      // felt like returning: two runs over unchanged data could see different
      // populations and publish different figures for the same group.
      orderBy: [{ entityId: 'asc' }, { fieldName: 'asc' }, { periodStart: 'asc' }, { id: 'asc' }],
      take: RECORD_CAP,
    }),
    prisma.entityLink.findMany({
      where: { status: 'CONFIRMED' },
      select: { entityAId: true, entityBId: true },
    }),
  ])

  const rows: BenchmarkRow[] = records.map(r => ({
    entityId: r.entityId,
    sector: r.entity.sector,
    domain: r.domain,
    fieldName: r.fieldName,
    value: r.value,
    unit: r.unit,
  }))
  const canonicalMap = buildCanonicalMap(links)
  const groups = buildDpGroups(rows, canonicalMap)

  if (groups.length === 0) {
    return ok({ status: 'noop', reason: 'no benchmarkable, consented, bounded records', epsilon })
  }

  // Identical data is released exactly once. Without this, looping the endpoint
  // and averaging the answers cancels the noise and recovers the true figure —
  // the guarantee is per-release, not per-request. See dp-release-ledger.ts.
  const ledgerRows = await prisma.dpBenchmarkRelease.findMany({
    where: { groupKey: { in: groups.map(g => g.key) }, epsilon },
  })
  const plan = planDpRelease(groups, epsilon, ledgerRows)

  try {
    const fresh =
      plan.toRelease.length > 0
        ? await releaseDpBenchmarks(plan.toRelease, { epsilon, minN: BENCHMARK_MIN_ENTITIES })
        : []

    if (fresh.length > 0) {
      await prisma.dpBenchmarkRelease.createMany({
        data: fresh.map(r => ({
          groupKey: r.key,
          epsilon,
          inputFingerprint: plan.fingerprints.get(r.key)!,
          suppressed: r.suppressed,
          n: r.n,
          dpMean: r.dp_mean ?? null,
          dpCount: r.dp_count ?? null,
        })),
        // A concurrent run may have recorded the same release first; that one
        // stands, and this response replays it on the next call.
        skipDuplicates: true,
      })
    }

    const releases = mergeReleases(groups, plan.replayed, fresh)
    const published = releases.filter(r => !r.suppressed)
    return ok({
      status: 'ok',
      epsilon,
      minEntities: BENCHMARK_MIN_ENTITIES,
      groupsConsidered: groups.length,
      newlyReleasedCount: fresh.length,
      replayedCount: plan.replayed.length,
      publishedCount: published.length,
      suppressedCount: releases.length - published.length,
      published,
    })
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      return err('Benchmark release is temporarily unavailable', 'BRAIN_UNAVAILABLE', 503)
    }
    throw e
  }
}
