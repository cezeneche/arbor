// Layer 2 — recording that a confirmed CBAM document produced a case.
//
// The Arbor side of the handoff. The mapping is in `nucleos/case-payload.ts`
// and the posting is in `nucleos/case-writer.ts`; what happens here is the one
// database write: a CbamCaseLink row saying which document became which case,
// under which regime, and what did not land.
//
// Runs after the confirmation has committed, and never rolls it back. The
// records are certified whether or not Nucleos was reachable — a network
// failure at the far end of a boundary must not undo a signed audit entry. So
// a failure is written down rather than thrown: the row is the only place the
// user can be told that the case they expected is not there.
//
// Idempotent on document. Confirming twice cannot open a second case for one
// real-world declaration, because the link row's unique constraint on
// documentId is the thing that prevents it, not a check-then-act.

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { buildCasePayload } from '@/lib/nucleos/case-payload'
import { createCbamCase } from '@/lib/nucleos/case-writer'
import { isCbamRelevant } from '@/lib/nucleos/cbam-relevance'
import type { CbamJurisdiction } from '@/lib/nucleos/jurisdiction'

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
  /** False when the document is not one that produces a case. */
  attempted: boolean
  caseId: string | null
  status: 'CREATED' | 'PARTIAL' | 'FAILED' | 'SKIPPED'
  problems: string[]
}

type Deps = {
  db?: PrismaClient | Prisma.TransactionClient
  createCase?: typeof createCbamCase
}

export async function handOffCbamCase(
  input: CbamHandoffInput,
  deps: Deps = {},
): Promise<CbamHandoffOutcome> {
  const db = (deps.db ?? defaultPrisma) as PrismaClient
  const createCase = deps.createCase ?? createCbamCase

  if (!isCbamRelevant(input.documentType)) {
    return { attempted: false, caseId: null, status: 'SKIPPED', problems: [] }
  }

  // A case already opened for this document is the answer. Re-posting would
  // duplicate a declaration, which double-counts the goods on every total the
  // importer sees.
  const existing = await db.cbamCaseLink.findUnique({
    where: { documentId: input.documentId },
    select: { nucleosCaseId: true, status: true, problems: true },
  })
  if (existing?.nucleosCaseId) {
    return {
      attempted: false,
      caseId: existing.nucleosCaseId,
      status: existing.status as CbamHandoffOutcome['status'],
      problems: existing.problems,
    }
  }

  const { payload, problems: mappingProblems } = buildCasePayload({
    confirmed: input.confirmed,
    jurisdiction: input.jurisdiction,
    reportingPeriodEnd: input.reportingPeriodEnd,
  })

  if (!payload) {
    await record(db, input, null, 'FAILED', mappingProblems, 0)
    return { attempted: true, caseId: null, status: 'FAILED', problems: mappingProblems }
  }

  let caseId: string | null = null
  let writeProblems: string[] = []
  let goodsLineCount = 0

  try {
    const written = await createCase(payload)
    caseId = written.caseId
    writeProblems = written.problems
    goodsLineCount = written.goodsLineIds.length
  } catch (err) {
    writeProblems = [
      `The case could not be opened: ${(err as Error).message}. ` +
        'Your figures are saved — confirm this document again once the connection is back.',
    ]
  }

  const problems = [...mappingProblems, ...writeProblems]
  const status: CbamHandoffOutcome['status'] =
    caseId === null ? 'FAILED' : problems.length > 0 ? 'PARTIAL' : 'CREATED'

  await record(db, input, caseId, status, problems, goodsLineCount)

  return { attempted: true, caseId, status, problems }
}

async function record(
  db: PrismaClient,
  input: CbamHandoffInput,
  caseId: string | null,
  status: 'CREATED' | 'PARTIAL' | 'FAILED',
  problems: string[],
  goodsLineCount: number,
): Promise<void> {
  await db.cbamCaseLink.upsert({
    where: { documentId: input.documentId },
    create: {
      entityId: input.entityId,
      documentId: input.documentId,
      nucleosCaseId: caseId,
      jurisdiction: input.jurisdiction,
      status,
      problems,
      goodsLineCount,
    },
    // A previous attempt that failed left a row with no case id. Updating it is
    // how a retry succeeds without leaving two records of one document.
    update: {
      nucleosCaseId: caseId,
      jurisdiction: input.jurisdiction,
      status,
      problems,
      goodsLineCount,
    },
  })
}
