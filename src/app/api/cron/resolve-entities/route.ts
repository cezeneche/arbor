// Offline entity-resolution job (Upgrade 5). Scheduled worker (Vercel Cron).
//
// Blocks the entity corpus into candidate pairs, scores them on the brain, and
// persists the match/review pairs as PENDING EntityLink candidates for human
// review. Non-destructive: it never merges or mutates entities — it only
// proposes edges. Runs off any write path; brain-down degrades to a no-op.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed if
// the secret is unset.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  candidatePairs,
  normaliseIdentityName,
  type BlockableEntity,
} from '@/lib/entity-resolution/blocking'
import {
  planEntityLinks,
  pairKey,
  type ExistingLink,
} from '@/lib/entity-resolution/link-planner'
import { scoreEntityPairs } from '@/lib/brain/resolution-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'
import type { ResolutionEntityName } from '@/lib/brain/types'

export const dynamic = 'force-dynamic'

const ENTITY_CAP = 5000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  // 1. Corpus → blockable entities → candidate pairs (deterministic, cheap).
  const entities = await prisma.entity.findMany({
    select: { id: true, legalName: true, registrationNumber: true, country: true, sector: true },
    take: ENTITY_CAP,
  })
  const blockable: BlockableEntity[] = entities
  const pairs = candidatePairs(blockable)
  if (pairs.length === 0) {
    return Response.json({ status: 'noop', reason: 'no candidate pairs', entities: entities.length })
  }

  // 2. Score the candidate pairs on the brain — fail soft. Brain down ⇒ skip.
  const names: ResolutionEntityName[] = entities.map(e => ({
    id: e.id,
    normalised: normaliseIdentityName(e.legalName),
  }))
  let scored
  try {
    scored = await scoreEntityPairs(names, pairs.map(([a, b]) => ({ a, b })))
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      return Response.json({ status: 'skipped', reason: 'brain unavailable', detail: e.message })
    }
    throw e
  }

  // 3. Existing links among the involved entities (stored id-sorted, so the
  //    smaller endpoint is entityAId) → keyed by pairKey for the planner.
  const involvedIds = [...new Set(pairs.flat())]
  const existingRows = await prisma.entityLink.findMany({
    where: { entityAId: { in: involvedIds } },
    select: { id: true, entityAId: true, entityBId: true, status: true },
  })
  const existing = new Map<string, ExistingLink>(
    existingRows.map(r => [pairKey(r.entityAId, r.entityBId), { id: r.id, status: r.status }]),
  )

  // 4. Plan and persist. Nothing auto-confirms — every new link lands PENDING.
  const { toCreate, toUpdate } = planEntityLinks(scored, existing)
  if (toCreate.length > 0) {
    await prisma.entityLink.createMany({ data: toCreate, skipDuplicates: true })
  }
  for (const u of toUpdate) {
    await prisma.entityLink.update({
      where: { id: u.id },
      data: { similarity: u.similarity, suggestedDecision: u.suggestedDecision },
    })
  }

  const decisions = scored.reduce<Record<string, number>>((acc, s) => {
    acc[s.decision] = (acc[s.decision] ?? 0) + 1
    return acc
  }, {})

  return Response.json({
    status: 'ok',
    entities: entities.length,
    candidatePairs: pairs.length,
    scored: scored.length,
    decisions,
    created: toCreate.length,
    updated: toUpdate.length,
  })
}
