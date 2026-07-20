// Accuracy & drift monitor. Scheduled worker (Vercel Cron).
//
// Reads the GroundTruthLabel stream and, per field group, compares the recent
// correct-rate against the historical baseline and the confidence-distribution
// PSI between the two windows. Persists one AccuracyRun + per-group metrics so
// extraction-accuracy degradation and input drift are tracked over time and made
// alertable. Pure measurement — no writes to certified data, no audit chain.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if
// the secret is unset. Runs in TS, not the brain: the arithmetic is trivial and
// a monitoring job must not depend on the brain being up to notice it going down.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  evaluateAccuracyDrift,
  DEFAULT_RECENT_WINDOW,
  DEFAULT_MIN_SAMPLES,
  type DriftLabel,
} from '@/lib/monitoring/accuracy-drift'
import { shouldAlert, buildAccuracyAlert } from '@/lib/monitoring/drift-alert'
import { dispatchDriftAlert } from '@/lib/monitoring/drift-alert-dispatch'

export const dynamic = 'force-dynamic'

const LABEL_CAP = 50000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Positive-integer query override, else the production default.
function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const params = new URL(req.url).searchParams
  const recentWindow = parsePositiveInt(params.get('recentWindow'), DEFAULT_RECENT_WINDOW)
  const minSamples = parsePositiveInt(params.get('minSamples'), DEFAULT_MIN_SAMPLES)

  const labels = await prisma.groundTruthLabel.findMany({
    select: { fieldName: true, wasCorrect: true, confidenceAtExtraction: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: LABEL_CAP,
  })
  if (labels.length === 0) {
    return Response.json({ status: 'noop', reason: 'no ground-truth labels yet' })
  }

  const driftLabels: DriftLabel[] = labels.map(l => ({
    fieldName: l.fieldName,
    wasCorrect: l.wasCorrect,
    confidenceAtExtraction: l.confidenceAtExtraction,
    createdAt: l.createdAt.getTime(),
  }))

  const report = evaluateAccuracyDrift(driftLabels, { recentWindow, minSamples })

  // Read the prior run's alarm state BEFORE writing this one, so the alert can be
  // edge-triggered (fire only on the transition into breach, not every run).
  const previous = await prisma.accuracyRun.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { degraded: true },
  })

  const run = await prisma.accuracyRun.create({
    data: {
      labelCount: labels.length,
      recentWindow,
      minSamples,
      degraded: report.degraded,
      groupMetrics: {
        create: report.groups.map(g => ({
          group: g.group,
          recentN: g.recentN,
          baselineN: g.baselineN,
          recentAccuracy: g.recentAccuracy,
          baselineAccuracy: g.baselineAccuracy,
          accuracyDelta: g.accuracyDelta,
          confidencePsi: g.confidencePsi,
          sufficient: g.sufficient,
          isKillSignalGroup: g.isKillSignalGroup,
          accuracyDegraded: g.accuracyDegraded,
          confidenceDrift: g.confidenceDrift,
        })),
      },
    },
    select: { id: true },
  })

  // Push an alert only on the transition into breach. Dispatch is fail-soft —
  // it never throws and never blocks the cron; the breach is persisted above and
  // readable on /api/admin/accuracy/health regardless.
  let alert: { sent: boolean; reason?: string } | null = null
  if (shouldAlert(report.degraded, previous?.degraded ?? null)) {
    alert = await dispatchDriftAlert(buildAccuracyAlert(run.id, report.groups, new Date()))
  }

  return Response.json({
    status: 'ok',
    runId: run.id,
    labels: labels.length,
    recentWindow,
    minSamples,
    degraded: report.degraded,
    alert,
    groups: report.groups.map(g => ({
      group: g.group,
      recentN: g.recentN,
      baselineN: g.baselineN,
      recentAccuracy: g.recentAccuracy,
      accuracyDelta: g.accuracyDelta,
      confidencePsi: g.confidencePsi,
      sufficient: g.sufficient,
      accuracyDegraded: g.accuracyDegraded,
      confidenceDrift: g.confidenceDrift,
    })),
  })
}
