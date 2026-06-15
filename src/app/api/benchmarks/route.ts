// Layer 3  -  read-only. Computes anonymised sector benchmarks on-the-fly from Tier A records.
// Only includes entities with allowBenchmarkAggregation=true.
// Population floor: 10 distinct entities required before any figure is shown (PRD §16.3).
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface BenchmarkPoint {
  sector: string
  domain: string
  fieldName: string
  unit: string
  year: number
  entityCount: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  mean: number
}

function computeStats(values: number[]): { min: number; q1: number; median: number; q3: number; max: number; mean: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
  const q1Idx = Math.floor(n / 4)
  const q3Idx = Math.floor((3 * n) / 4)
  return {
    min: sorted[0],
    q1: sorted[q1Idx],
    median,
    q3: sorted[q3Idx],
    max: sorted[n - 1],
    mean: Math.round((values.reduce((a, b) => a + b, 0) / n) * 100) / 100,
  }
}

const POPULATION_FLOOR = 10

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const filterSector = sp.get('sector') ?? undefined
  const filterDomain = sp.get('domain') ?? undefined
  const filterYear = sp.get('year') ? parseInt(sp.get('year')!, 10) : undefined

  // Find all entities that have opted in
  const optedInEntities = await prisma.entity.findMany({
    where: { allowBenchmarkAggregation: true },
    select: { id: true, sector: true },
  })

  if (optedInEntities.length === 0) {
    return NextResponse.json({ benchmarks: [], floor: POPULATION_FLOOR, optedInEntities: 0 })
  }

  const entityIds = optedInEntities.map(e => e.id)
  const sectorMap = new Map(optedInEntities.map(e => [e.id, e.sector]))

  // Fetch active Tier A records for opted-in entities with numeric values
  const records = await prisma.dataRecord.findMany({
    where: {
      entityId: { in: entityIds },
      trustTier: 'A',
      isActive: true,
      ...(filterDomain ? { domain: filterDomain as never } : {}),
    },
    select: {
      entityId: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      periodStart: true,
    },
  })

  // Group: sector × domain × fieldName × year → { entityId → values[] }
  type GroupKey = string
  const groups = new Map<GroupKey, { values: { entityId: string; value: number }[]; unit: string }>()

  for (const r of records) {
    if (typeof r.value !== 'number' || isNaN(r.value)) continue
    const year = new Date(r.periodStart).getFullYear()
    if (filterYear !== undefined && year !== filterYear) continue

    const sector = sectorMap.get(r.entityId) ?? 'Unknown'
    if (filterSector && sector !== filterSector) continue

    const key = `${sector}||${r.domain}||${r.fieldName}||${year}||${r.unit}`
    if (!groups.has(key)) groups.set(key, { values: [], unit: r.unit })
    groups.get(key)!.values.push({ entityId: r.entityId, value: r.value })
  }

  const benchmarks: BenchmarkPoint[] = []

  for (const [key, group] of groups.entries()) {
    const [sector, domain, fieldName, yearStr] = key.split('||')
    // unit comes from group.unit (already set on first insert for this key)

    // Population floor: count distinct entities
    const distinctEntities = new Set(group.values.map(v => v.entityId))
    if (distinctEntities.size < POPULATION_FLOOR) continue

    // One value per entity (median of that entity's records) to prevent prolific
    // entities from skewing the distribution.
    const entityMedians = [...distinctEntities].map(eid => {
      const entityVals = group.values.filter(v => v.entityId === eid).map(v => v.value).sort((a, b) => a - b)
      const mid = Math.floor(entityVals.length / 2)
      return entityVals.length % 2 === 0 ? (entityVals[mid - 1] + entityVals[mid]) / 2 : entityVals[mid]
    })
    const stats = computeStats(entityMedians)

    benchmarks.push({
      sector,
      domain,
      fieldName,
      unit: group.unit,
      year: parseInt(yearStr, 10),
      entityCount: distinctEntities.size,
      ...stats,
    })
  }

  benchmarks.sort((a, b) =>
    a.sector.localeCompare(b.sector) ||
    a.domain.localeCompare(b.domain) ||
    a.fieldName.localeCompare(b.fieldName) ||
    b.year - a.year
  )

  // Distinct sectors and domains available (for filter UI)
  const availableSectors = [...new Set(optedInEntities.map(e => e.sector))].sort()
  const availableDomains = [...new Set(records.map(r => r.domain))].sort()

  return NextResponse.json({
    benchmarks,
    floor: POPULATION_FLOOR,
    optedInEntities: optedInEntities.length,
    availableSectors,
    availableDomains,
  })
}
