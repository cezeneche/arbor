// Supabase free-tier keep-alive. The project is paused after a stretch of no
// activity; this scheduled worker issues a trivial query so the database registers
// regular activity and stays awake. Reads and writes nothing of substance.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if the
// secret is unset. Scheduled in vercel.json.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  // SELECT 1 opens a real connection to Postgres — enough activity to reset the
  // inactivity timer — without touching any table.
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ status: 'ok', pingedAt: new Date().toISOString() })
  } catch (e) {
    console.error('[cron/keepalive] database ping failed:', e)
    return Response.json({ status: 'error' }, { status: 500 })
  }
}
