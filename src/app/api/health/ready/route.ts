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
import { serviceTokenExpiry } from '@/lib/nucleos/service-auth'

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

async function checkNucleos(): Promise<{ ok: boolean; detail?: string }> {
  const url = process.env.NUCLEOS_URL
  if (!url) return { ok: false, detail: 'NUCLEOS_URL is not set.' }
  try {
    const res = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    return res.ok ? { ok: true } : { ok: false, detail: `Nucleos reported ${res.status}.` }
  } catch {
    return { ok: false, detail: 'Nucleos did not answer.' }
  }
}

export async function GET(req: NextRequest) {
  const [database, nucleos] = await Promise.all([checkDatabase(), checkNucleos()])
  const readiness = evaluateReadiness({
    missingEnv: missingProductionEnv(process.env),
    database,
    nucleos,
    serviceToken: serviceTokenExpiry(process.env.NUCLEOS_INTERNAL_TOKEN ?? ''),
  })

  const secret = process.env.CRON_SECRET
  const operator = Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`
  return NextResponse.json(operator ? readiness : { ready: readiness.ready }, {
    status: readiness.ready ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
