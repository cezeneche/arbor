import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { ok } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ACCURACY_DROP_THRESHOLD, PSI_DRIFT_THRESHOLD } from '@/lib/monitoring/accuracy-drift'
import { KILL_SIGNAL_GROUPS } from '@/lib/confidence/calibration-metrics'

// Accuracy & drift monitoring surface. Internal (ADMIN only). Reads the persisted
// AccuracyRun metrics so extraction-accuracy degradation and confidence drift are
// observable over time: has any field group's recent correct-rate fallen past the
// threshold, or its confidence distribution shifted (PSI)? Read-only.
export async function GET() {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!

  const thresholds = { accuracyDrop: ACCURACY_DROP_THRESHOLD, psiDrift: PSI_DRIFT_THRESHOLD }

  const latest = await prisma.accuracyRun.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { groupMetrics: { orderBy: { group: 'asc' } } },
  })

  if (!latest) {
    return ok({
      status: 'no-runs',
      reason: 'the accuracy-drift cron has not recorded a run yet',
      thresholds,
      killSignalGroups: KILL_SIGNAL_GROUPS,
    })
  }

  // Recent history of the headline alarm, for at-a-glance trend.
  const history = await prisma.accuracyRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, createdAt: true, labelCount: true, degraded: true },
  })

  return ok({
    status: latest.degraded ? 'drift-detected' : 'ok',
    thresholds,
    killSignalGroups: KILL_SIGNAL_GROUPS,
    latestRun: {
      id: latest.id,
      createdAt: latest.createdAt.toISOString(),
      labelCount: latest.labelCount,
      recentWindow: latest.recentWindow,
      minSamples: latest.minSamples,
      degraded: latest.degraded,
      groups: latest.groupMetrics.map(m => ({
        group: m.group,
        recentN: m.recentN,
        baselineN: m.baselineN,
        recentAccuracy: m.recentAccuracy,
        baselineAccuracy: m.baselineAccuracy,
        accuracyDelta: m.accuracyDelta,
        confidencePsi: m.confidencePsi,
        sufficient: m.sufficient,
        isKillSignalGroup: m.isKillSignalGroup,
        accuracyDegraded: m.accuracyDegraded,
        confidenceDrift: m.confidenceDrift,
      })),
    },
    history: history.map(h => ({
      id: h.id,
      createdAt: h.createdAt.toISOString(),
      labelCount: h.labelCount,
      degraded: h.degraded,
    })),
  })
}
