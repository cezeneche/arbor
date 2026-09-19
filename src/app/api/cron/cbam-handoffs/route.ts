// Resumes CBAM handoffs that did not finish. Scheduled worker (Vercel Cron).
//
// A handoff runs straight after its confirmation, and the user can resume one
// from the CBAM page. This catches the rest: a confirmation whose process died
// after the commit, or a Nucleos outage nobody came back to. It runs the same
// resumable handoff as everything else, so it can never open a second case.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if
// the secret is unset.
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runCbamHandoff, SWEEP_MAX_ATTEMPTS } from '@/lib/layer2/cbam-handoff'

export const dynamic = 'force-dynamic'

const BATCH = 20
// Leave a handoff alone while its own request may still be running it.
const SETTLE_MS = 5 * 60 * 1000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const due = await prisma.cbamCaseLink.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED', 'PARTIAL'] },
      // The attempt cap keeps a handoff that can never succeed — a declaration
      // missing its importer, say — from being retried forever. The user can
      // still resume it by hand.
      attempts: { lt: SWEEP_MAX_ATTEMPTS },
      handoffInput: { not: Prisma.AnyNull },
      updatedAt: { lt: new Date(Date.now() - SETTLE_MS) },
    },
    orderBy: { updatedAt: 'asc' },
    take: BATCH,
    select: { documentId: true },
  })

  let created = 0
  let errors = 0
  for (const { documentId } of due) {
    try {
      const outcome = await runCbamHandoff(documentId)
      if (outcome.status === 'CREATED') created++
    } catch (e) {
      errors++
      console.error('[cron/cbam-handoffs] resume failed for', documentId, e)
    }
  }

  return NextResponse.json({ resumed: due.length, created, errors })
}
