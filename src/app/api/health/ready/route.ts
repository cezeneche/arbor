// Readiness: can this deployment serve the product right now.
//
// Public for uptime monitors, which get only ready / not ready (200 / 503).
// The per-check breakdown — which settings are missing, when the Nucleos token
// expires — is for operators, behind the CRON_SECRET bearer the scheduled jobs
// already use.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { missingProductionEnv } from '@/lib/production-env'
import { evaluateReadiness } from '@/lib/readiness'
import { rateLimiterHealth } from '@/lib/rate-limit'
import { serviceTokenExpiry } from '@/lib/nucleos/service-auth'
import { probeNucleos } from '@/lib/nucleos/readiness-probe'

export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 3000

async function checkDatabase(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true }
  } catch {
    return { ok: false, detail: 'The database did not answer.' }
  }
}

export async function GET(req: NextRequest) {
  const [database, nucleos, rateLimiter] = await Promise.all([
    checkDatabase(),
    probeNucleos(process.env.NUCLEOS_URL, { timeoutMs: TIMEOUT_MS }),
    rateLimiterHealth(),
  ])
  const readiness = evaluateReadiness({
    missingEnv: missingProductionEnv(process.env),
    database,
    nucleos,
    rateLimiter,
    serviceToken: serviceTokenExpiry(process.env.NUCLEOS_INTERNAL_TOKEN ?? ''),
  })

  const secret = process.env.CRON_SECRET
  const operator = Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`
  return NextResponse.json(operator ? readiness : { ready: readiness.ready }, {
    status: readiness.ready ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
