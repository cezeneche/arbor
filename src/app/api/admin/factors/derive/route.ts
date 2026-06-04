// Admin-only endpoint. Derives emission factors from Tier A records across all
// opted-in entities and upserts into EmissionFactor table with isDerived=true.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deriveAllFactors } from '@/lib/aggregation/factor-derivation'

export async function POST() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const role = (session.user as Record<string, unknown>).role as string
  if (role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })

  const year = new Date().getFullYear()

  const records = await prisma.dataRecord.findMany({
    where: {
      isActive: true,
      trustTier: 'A',
      entity: { allowBenchmarkAggregation: true },
    },
    select: { domain: true, fieldName: true, value: true, unit: true },
  })

  const derived = deriveAllFactors({
    records: records.map(r => ({
      domain: r.domain,
      fieldName: r.fieldName,
      value: r.value,
      unit: r.unit,
    })),
    year,
  })

  const versionDate = new Date().toISOString().slice(0, 10)
  let upsertCount = 0

  for (const f of derived) {
    // Deactivate any existing derived factor for the same activityType
    await prisma.emissionFactor.updateMany({
      where: { activityType: f.activityType, isDerived: true, isActive: true },
      data: { isActive: false },
    })

    await prisma.emissionFactor.create({
      data: {
        activityType: f.activityType,
        source: 'Arbor Tier A Dataset',
        version: versionDate,
        year,
        factor: f.factor,
        unit: f.unit,
        citation: f.citation,
        isDerived: true,
        isActive: true,
        confidenceIntervalLower: f.confidenceIntervalLower,
        confidenceIntervalUpper: f.confidenceIntervalUpper,
        sampleSize: f.sampleSize,
      },
    })
    upsertCount++
  }

  return NextResponse.json({
    ok: true,
    recordsProcessed: records.length,
    factorsDerived: derived.length,
    factorsUpserted: upsertCount,
  })
}
