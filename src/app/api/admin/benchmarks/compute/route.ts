// Admin-only endpoint. Queries all Tier A DataRecords from opted-in entities,
// computes sector benchmarks, and upserts into SectorBenchmark table.
// [PRD §15.3 — Governance gate: min 10 entities enforced by computeSectorBenchmarks()]

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeSectorBenchmarks } from '@/lib/aggregation/sector-benchmark'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Platform-level operation: requires PLATFORM_ADMIN_SECRET header, not just entity ADMIN role.
  // Entity admins must not be able to trigger global benchmark recomputation.
  const platformSecret = process.env.PLATFORM_ADMIN_SECRET
  if (!platformSecret) return NextResponse.json({ error: 'Platform admin secret not configured' }, { status: 500 })
  if (req.headers.get('x-platform-admin-secret') !== platformSecret) {
    return NextResponse.json({ error: 'Forbidden — platform admin only' }, { status: 403 })
  }

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

  // Upsert — each unique sector+domain+fieldName+year combination
  let upsertCount = 0
  for (const b of benchmarks) {
    await prisma.sectorBenchmark.upsert({
      where: { sector_domain_fieldName_year: { sector: b.sector, domain: b.domain as never, fieldName: b.fieldName, year: b.year } },
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
