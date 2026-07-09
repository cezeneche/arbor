import { NextRequest } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildCanonicalMap } from '@/lib/aggregation/entity-canonical'
import { buildDpGroups, type BenchmarkRow } from '@/lib/aggregation/dp-benchmark-input'
import { BENCHMARK_MIN_ENTITIES } from '@/lib/aggregation/sector-benchmark'
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

  try {
    const releases = await releaseDpBenchmarks(groups, { epsilon, minN: BENCHMARK_MIN_ENTITIES })
    const published = releases.filter(r => !r.suppressed)
    return ok({
      status: 'ok',
      epsilon,
      minEntities: BENCHMARK_MIN_ENTITIES,
      groupsConsidered: groups.length,
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
