// Layer 2 — the handoff from a confirmed CBAM document to a Nucleos case.
//
// The mapping is in `nucleos/case-payload.ts` and the posting is in
// `nucleos/case-writer.ts`. What happens here is the bookkeeping that makes the
// handoff durable: a CbamCaseLink row per document, recorded as PENDING in the
// confirmation's own transaction together with everything needed to run it, and
// updated after every step that lands in Nucleos.
//
// It never rolls the confirmation back. The records are certified whether or
// not Nucleos was reachable — a network failure at the far end of a boundary
// must not undo a signed audit entry. So a failure is written down rather than
// thrown, and it can be resumed: straight after the confirmation, from the
// Resume action on the CBAM screen, or by the sweep. A resume adds only what is
// missing, because the row records which case, shipment and goods lines exist.
//
// One case per document. The link row's unique documentId stops a second row,
// and the lease below stops two attempts on one row running at the same time —
// which is what used to open two remote cases before either recorded its id.

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { buildCasePayload } from '@/lib/nucleos/case-payload'
import { emptyProgress, writeCbamCase, type CaseWriteProgress } from '@/lib/nucleos/case-writer'
import { isCbamRelevant } from '@/lib/nucleos/cbam-relevance'
import { resolveJurisdiction, type CbamJurisdiction } from '@/lib/nucleos/jurisdiction'

/** How long an attempt may hold the row before another may take it over. Longer
 *  than any single attempt can run: every post has its own 30s timeout. */
export const LEASE_MS = 10 * 60 * 1000

/** How many times the sweep tries one handoff before leaving it to the user. */
export const SWEEP_MAX_ATTEMPTS = 5

export interface CbamHandoffInput {
  documentId: string
  entityId: string
  documentType: string
  jurisdiction: CbamJurisdiction
  /** Field name → the value the reviewer confirmed. */
  confirmed: ReadonlyMap<string, string>
  /** The period the confirmed records cover; sets the case's year and quarter. */
  reportingPeriodEnd: Date
}

export interface CbamHandoffOutcome {
  /** False when nothing was attempted: no handoff, finished, or already running. */
  attempted: boolean
  caseId: string | null
  status: 'PENDING' | 'CREATED' | 'PARTIAL' | 'FAILED' | 'SKIPPED'
  problems: string[]
}

/** What is stored on the row so a resume does not need the original request. */
interface StoredInput {
  documentType: string
  confirmed: Record<string, string>
  reportingPeriodEnd: string
}

type Db = PrismaClient | Prisma.TransactionClient

type Deps = {
  db?: Db
  writeCase?: typeof writeCbamCase
}

const RESUME_HINT = 'Your figures are saved. Use Resume on the CBAM page to finish opening the case.'

/**
 * Records the handoff as PENDING. Call inside the confirmation's transaction,
 * so a confirmed CBAM document can never exist without its handoff on record.
 * Returns false when the document type produces no case.
 */
export async function enqueueCbamHandoff(tx: Db, input: CbamHandoffInput): Promise<boolean> {
  if (!isCbamRelevant(input.documentType)) return false

  const handoffInput: StoredInput = {
    documentType: input.documentType,
    confirmed: Object.fromEntries(input.confirmed),
    reportingPeriodEnd: input.reportingPeriodEnd.toISOString(),
  }
  await (tx as PrismaClient).cbamCaseLink.upsert({
    where: { documentId: input.documentId },
    create: {
      entityId: input.entityId,
      documentId: input.documentId,
      nucleosCaseId: null,
      jurisdiction: input.jurisdiction,
      status: 'PENDING',
      problems: [],
      goodsLineCount: 0,
      handoffInput: handoffInput as unknown as Prisma.InputJsonValue,
    },
    // A document is confirmed once, so a row already here is a leftover from
    // before handoffs were resumable. Give it the input it was missing, but
    // leave any case it already opened alone.
    update: { handoffInput: handoffInput as unknown as Prisma.InputJsonValue },
  })
  return true
}

/**
 * Runs, or resumes, the handoff for one document.
 *
 * Safe to call any number of times from anywhere: a finished handoff is left
 * alone, an attempt already running is left to finish, and anything that
 * already landed in Nucleos is not posted again.
 */
export async function runCbamHandoff(
  documentId: string,
  deps: Deps = {},
): Promise<CbamHandoffOutcome> {
  const db = (deps.db ?? defaultPrisma) as PrismaClient
  const writeCase = deps.writeCase ?? writeCbamCase

  // Claim the row. Only one attempt gets it; a crashed attempt's claim goes
  // stale and can then be taken over.
  const now = new Date()
  const claimed = await db.cbamCaseLink.updateMany({
    where: {
      documentId,
      status: { in: ['PENDING', 'FAILED', 'PARTIAL'] },
      OR: [{ attemptStartedAt: null }, { attemptStartedAt: { lt: new Date(now.getTime() - LEASE_MS) } }],
    },
    data: { attemptStartedAt: now, attempts: { increment: 1 } },
  })

  const row = await db.cbamCaseLink.findUnique({ where: { documentId } })
  if (!row) return { attempted: false, caseId: null, status: 'SKIPPED', problems: [] }
  if (claimed.count === 0) {
    // Finished, or someone else is on it. Either way this is the state.
    return {
      attempted: false,
      caseId: row.nucleosCaseId,
      status: row.attemptStartedAt ? 'PENDING' : (row.status as CbamHandoffOutcome['status']),
      problems: row.problems,
    }
  }

  const finish = async (
    caseId: string | null,
    status: 'CREATED' | 'PARTIAL' | 'FAILED',
    problems: string[],
    goodsLineCount: number,
  ): Promise<CbamHandoffOutcome> => {
    await db.cbamCaseLink.update({
      where: { documentId },
      data: { nucleosCaseId: caseId, status, problems, goodsLineCount, attemptStartedAt: null },
    })
    return { attempted: true, caseId, status, problems }
  }

  const stored = row.handoffInput as StoredInput | null
  if (!stored?.confirmed || !stored.reportingPeriodEnd) {
    const note =
      'This case cannot be resumed automatically: it was handed off before Arbor kept what it needs to retry.'
    return finish(
      row.nucleosCaseId,
      row.nucleosCaseId ? 'PARTIAL' : 'FAILED',
      [note, ...row.problems.filter(p => p !== note)],
      row.goodsLineCount,
    )
  }

  const { payload, problems: mappingProblems } = buildCasePayload({
    confirmed: new Map(Object.entries(stored.confirmed)),
    jurisdiction: resolveJurisdiction(row.jurisdiction),
    reportingPeriodEnd: new Date(stored.reportingPeriodEnd),
  })
  if (!payload) return finish(null, 'FAILED', mappingProblems, 0)

  const start = (row.progress as CaseWriteProgress | null) ?? {
    ...emptyProgress(),
    caseId: row.nucleosCaseId,
  }
  let latest = start

  try {
    const written = await writeCase(payload, start, {
      onProgress: async progress => {
        latest = progress
        await db.cbamCaseLink.update({
          where: { documentId },
          data: {
            progress: progress as unknown as Prisma.InputJsonValue,
            nucleosCaseId: progress.caseId,
          },
        })
      },
    })
    const problems = [...mappingProblems, ...written.problems]
    const status = written.caseId === null ? 'FAILED' : problems.length > 0 ? 'PARTIAL' : 'CREATED'
    return finish(written.caseId, status, problems, written.goodsLineIds.length)
  } catch (err) {
    const caseId = latest.caseId
    const problem = caseId
      ? `The case was opened but could not be finished: ${(err as Error).message}. ${RESUME_HINT}`
      : `The case could not be opened: ${(err as Error).message}. ${RESUME_HINT}`
    return finish(
      caseId,
      caseId ? 'PARTIAL' : 'FAILED',
      [...mappingProblems, problem],
      Object.keys(latest.lines).length,
    )
  }
}
