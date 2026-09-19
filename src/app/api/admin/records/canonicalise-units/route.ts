import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { runSerializable } from '@/lib/layer2/serializable'
import { applyUnitCorrection, planUnitCorrections, type StoredRecord } from '@/lib/layer2/unit-correction'

// One-off correction of records stored before every write path used canonical
// units. Platform operators only, because it spans every entity.
//
// GET  — the plan: which active records would be superseded, and with what.
// POST — applies it, one serializable transaction per record so each lands with
//        its own audit entry. Re-running is harmless: a corrected record is no
//        longer active, and a canonical one is left alone.

async function activeRecords(): Promise<StoredRecord[]> {
  return (await prisma.dataRecord.findMany({ where: { isActive: true } })) as unknown as StoredRecord[]
}

export async function GET() {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!
  return NextResponse.json(planUnitCorrections(await activeRecords()))
}

export async function POST() {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!

  const plan = planUnitCorrections(await activeRecords())
  const applied: { id: string; supersededBy: string }[] = []
  for (const { id } of plan.corrections) {
    const out = await runSerializable(tx => applyUnitCorrection(tx, id))
    if (out) applied.push(out)
  }
  return NextResponse.json({ applied, unconvertible: plan.unconvertible })
}
