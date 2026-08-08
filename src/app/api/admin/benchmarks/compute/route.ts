// Admin-only endpoint. Queries all Tier A DataRecords from opted-in entities,
// computes sector benchmarks, and upserts into SectorBenchmark table.
// [PRD §15.3  -  Governance gate: min 10 entities enforced by computeSectorBenchmarks()]

import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { computeSectorBenchmarks } from '@/lib/aggregation/sector-benchmark'

// Platform-level operation: recomputes global sector benchmarks across all
// consenting entities. Gated on the platform-operator flag (like the sibling
// benchmarks/dp route) — a tenant ADMIN must not be able to trigger it.
export async function POST() {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!

  const year = new Date().getFullYear()

  // Only records from entities that have given explicit consent
  const records = await prisma.dataRecord.findMany({
    where: {
      isActive: true,
      trustTier: 'A',
      entity: { allowBenchmarkAggregation: true },
    },
    select: {
      entityId: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      trustTier: true,
      entity: { select: { sector: true } },
    },
  })

  const flat = records.map(r => ({
    entityId: r.entityId,
    sector: r.entity.sector,
    domain: r.domain,
    fieldName: r.fieldName,
    value: r.value,
    unit: r.unit,
    trustTier: r.trustTier as 'A',
  }))

  const benchmarks = computeSectorBenchmarks({ records: flat, year })

  // Upsert  -  each unique sector+domain+fieldName+year combination
  let upsertCount = 0
  for (const b of benchmarks) {
    await prisma.sectorBenchmark.upsert({
      where: { sector_domain_fieldName_unit_year: { sector: b.sector, domain: b.domain as never, fieldName: b.fieldName, unit: b.unit, year: b.year } },
      create: { ...b, domain: b.domain as never },
      update: { ...b, domain: b.domain as never },
    })
    upsertCount++
  }

  return NextResponse.json({
    ok: true,
    recordsProcessed: records.length,
    benchmarksComputed: benchmarks.length,
    benchmarksUpserted: upsertCount,
    year,
  })
}
