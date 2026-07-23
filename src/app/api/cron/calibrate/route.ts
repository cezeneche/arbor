// Offline calibration job. Scheduled worker (Vercel Cron).
//
// Reads GroundTruthLabel → fits calibration on the brain → writes a calibrated
// confidencePosterior back onto active DataRecords, grouped by field type. Runs
// off the write path; brain-down degrades to a no-op rather than erroring.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if
// the secret is unset. Schedule this in Vercel (dashboard or a `crons` entry),
// e.g. daily: { "path": "/api/cron/calibrate", "schedule": "0 3 * * *" }.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  buildCalibrationSamples,
  fitCalibration,
  BrainUnavailableError,
  type GroundTruthRow,
} from '@/lib/brain/calibration-client'
import { buildPosteriorUpdates, parseMinSamples } from '@/lib/confidence/backfill'
import { evaluateCalibrationRun } from '@/lib/confidence/calibration-metrics'
import { shouldAlert, buildCalibrationAlert } from '@/lib/monitoring/drift-alert'
import { dispatchDriftAlert } from '@/lib/monitoring/drift-alert-dispatch'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const RECORD_BATCH = 1000
const LABEL_CAP = 50000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  // Optional override: how many labels a group needs before its calibration is
  // trusted enough to write back. Absent → the production default (30). Used to
  // observe a posterior land during verification without waiting for volume.
  const minSamples = parseMinSamples(new URL(req.url).searchParams.get('minSamples'))

  // 1. Ground-truth labels (bounded) → grouped calibration samples.
  const labels = await prisma.groundTruthLabel.findMany({
    // Calibration maps model confidence -> P(correct), so the ground truth must be
    // authoritative: only the data owner's review labels. Buyer-sourced signal
    // (BUYER_*) is a third-party opinion and is deliberately excluded from the fit.
    where: { source: { in: ['REVIEW_CONFIRMED', 'REVIEW_CORRECTED'] } },
    select: {
      fieldName: true,
      documentClass: true,
      confidenceAtExtraction: true,
      wasCorrect: true,
    },
    orderBy: { createdAt: 'desc' },
    take: LABEL_CAP,
  })
  if (labels.length === 0) {
    return Response.json({ status: 'noop', reason: 'no ground-truth labels yet' })
  }
  const samples = buildCalibrationSamples(labels as GroundTruthRow[], 'fieldType')

  // 2. Fit on the brain — fail soft. Brain down ⇒ skip this run, never error.
  let fit
  try {
    fit = await fitCalibration(samples, { bins: 10, minSamples })
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      return Response.json({ status: 'skipped', reason: 'brain unavailable', detail: e.message })
    }
    throw e
  }

  // 2b. Close the measurement loop: persist headline ECE/Brier per group and
  // evaluate the kill signal (ECE < 5% for supplier identity, mass, emissions
  // intensity). This is derived measurement, not certified data — it never
  // touches the audit chain.
  const { metrics, killSignalBreached } = evaluateCalibrationRun(fit.groups)

  // Prior alarm state, read before this run is written, so the alert is
  // edge-triggered (fires only on the transition into breach).
  const previousRun = await prisma.calibrationRun.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { killSignalBreached: true },
  })

  const run = await prisma.calibrationRun.create({
    data: {
      labelCount: labels.length,
      minSamples: minSamples ?? 30,
      brainFittedAt: new Date(fit.fitted_at),
      killSignalBreached,
      groupMetrics: { create: metrics },
    },
    select: { id: true },
  })

  // Push an alert only on the transition into breach. Fail-soft — dispatch never
  // throws and never blocks the cron; the breach is persisted above and readable
  // on /api/admin/calibration/health regardless.
  let alert: { sent: boolean; reason?: string } | null = null
  if (shouldAlert(killSignalBreached, previousRun?.killSignalBreached ?? null)) {
    alert = await dispatchDriftAlert(buildCalibrationAlert(run.id, metrics, new Date()))
  }

  // 3. Apply calibration to active records in batches. Records that share a
  // (group, rawScore) share a posterior, so collapse them into one updateMany.
  let scanned = 0
  let updated = 0
  let cursor: string | undefined
  for (;;) {
    const records = await prisma.dataRecord.findMany({
      where: { isActive: true },
      select: { id: true, fieldName: true, confidenceScore: true },
      orderBy: { id: 'asc' },
      take: RECORD_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (records.length === 0) break
    scanned += records.length
    cursor = records[records.length - 1].id

    const updates = buildPosteriorUpdates(records, fit.groups)
    const byPosterior = new Map<string, { posterior: unknown; ids: string[] }>()
    for (const u of updates) {
      const key = JSON.stringify(u.posterior)
      const entry = byPosterior.get(key) ?? { posterior: u.posterior, ids: [] }
      entry.ids.push(u.recordId)
      byPosterior.set(key, entry)
    }
    for (const { posterior, ids } of byPosterior.values()) {
      await prisma.dataRecord.updateMany({
        where: { id: { in: ids } },
        data: { confidencePosterior: posterior as Prisma.InputJsonValue },
      })
    }
    updated += updates.length

    if (records.length < RECORD_BATCH) break
  }

  return Response.json({
    status: 'ok',
    runId: run.id,
    labels: labels.length,
    minSamples: minSamples ?? 30,
    killSignalBreached,
    alert,
    groups: fit.groups.map(g => ({ group: g.group, n: g.n, ece: g.ece, sufficient: g.sufficient })),
    recordsScanned: scanned,
    recordsUpdated: updated,
    fittedAt: fit.fitted_at,
  })
}
