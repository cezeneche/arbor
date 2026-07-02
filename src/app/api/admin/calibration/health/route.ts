import { requireAdmin } from '@/lib/auth-helpers'
import { ok } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { KILL_SIGNAL_GROUPS, ECE_KILL_THRESHOLD } from '@/lib/confidence/calibration-metrics'

// Upgrade 1 — measurement loop, monitoring surface. Internal (ADMIN only).
// Reads the persisted calibration metrics so the headline ECE / Brier are
// observable over time and the kill signal is watchable: is the calibration ECE
// under 5% for supplier identity, mass, and emissions intensity? Read-only.
export async function GET() {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const latest = await prisma.calibrationRun.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { groupMetrics: { orderBy: { group: 'asc' } } },
  })

  if (!latest) {
    return ok({
      status: 'no-runs',
      reason: 'the calibration cron has not recorded a run yet',
      killSignal: { threshold: ECE_KILL_THRESHOLD, groups: KILL_SIGNAL_GROUPS },
    })
  }

  // Recent history of the headline alarm, for at-a-glance trend.
  const history = await prisma.calibrationRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, createdAt: true, labelCount: true, killSignalBreached: true },
  })

  const killSignalGroups = latest.groupMetrics.filter(m => m.isKillSignalGroup)

  return ok({
    status: latest.killSignalBreached ? 'kill-signal-breached' : 'ok',
    killSignal: {
      threshold: ECE_KILL_THRESHOLD,
      groups: KILL_SIGNAL_GROUPS,
      breached: latest.killSignalBreached,
    },
    latestRun: {
      id: latest.id,
      createdAt: latest.createdAt.toISOString(),
      labelCount: latest.labelCount,
      minSamples: latest.minSamples,
      brainFittedAt: latest.brainFittedAt.toISOString(),
      killSignalBreached: latest.killSignalBreached,
      killSignalGroups: killSignalGroups.map(m => ({
        group: m.group,
        n: m.n,
        ece: m.ece,
        brier: m.brier,
        sufficient: m.sufficient,
        breached: m.breached,
      })),
      allGroups: latest.groupMetrics.map(m => ({
        group: m.group,
        n: m.n,
        ece: m.ece,
        brier: m.brier,
        sufficient: m.sufficient,
        isKillSignalGroup: m.isKillSignalGroup,
        breached: m.breached,
      })),
    },
    history: history.map(h => ({
      id: h.id,
      createdAt: h.createdAt.toISOString(),
      labelCount: h.labelCount,
      killSignalBreached: h.killSignalBreached,
    })),
  })
}
