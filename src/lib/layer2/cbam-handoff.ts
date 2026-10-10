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
import type { ReadField } from '@/lib/nucleos/case-evidence'
import {
  amendCaseIdentifiers,
  missingCaseIdentifiers,
  type CaseIdentifierAmendment,
  type CaseIdentifierNeed,
} from '@/lib/nucleos/case-identifiers'
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
  /** What extraction read, sent as evidence once the goods lines exist. */
  readFields?: ReadField[]
}

export interface CbamHandoffOutcome {
  /** False when nothing was attempted: no handoff, finished, or already running. */
  attempted: boolean
  caseId: string | null
  status: 'PENDING' | 'CREATED' | 'PARTIAL' | 'FAILED' | 'NEEDS_INPUT' | 'SKIPPED'
  problems: string[]
  /** What the user can supply to let a NEEDS_INPUT handoff continue. */
  needs?: CaseIdentifierNeed[]
}

/** What is stored on the row so a resume does not need the original request. */
interface StoredInput {
  documentType: string
  confirmed: Record<string, string>
  reportingPeriodEnd: string
  /** Identifiers supplied after confirmation, and by whom — `confirmed` holds
   *  them too, so this is their provenance rather than a second copy to read. */
  amendments?: { fieldName: string; value: string; byId: string; at: string }[]
  /** What extraction read; absent on handoffs recorded before it was kept. */
  readFields?: ReadField[]
}

/** What a handoff's stored input is missing that the user can supply. */
export function handoffNeeds(handoffInput: unknown): CaseIdentifierNeed[] {
  const stored = handoffInput as StoredInput | null
  return stored?.confirmed ? missingCaseIdentifiers(new Map(Object.entries(stored.confirmed))) : []
}

type Db = PrismaClient | Prisma.TransactionClient

type Deps = {
  db?: Db
  writeCase?: typeof writeCbamCase
}

class ForeignCaseError extends Error {
  constructor() {
    super(
      'Nucleos returned a case that belongs to another organisation, so it was not opened here. ' +
        'Nothing was added to it. Contact support to open this case.',
    )
  }
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
    ...(input.readFields && input.readFields.length > 0 ? { readFields: input.readFields } : {}),
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
export async function runCbamHandoff(documentId: string, deps: Deps = {}): Promise<CbamHandoffOutcome> {
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
    const status = row.attemptStartedAt ? 'PENDING' : (row.status as CbamHandoffOutcome['status'])
    return {
      attempted: false,
      caseId: row.nucleosCaseId,
      status,
      problems: row.problems,
      ...(status === 'NEEDS_INPUT' ? { needs: handoffNeeds(row.handoffInput) } : {}),
    }
  }

  const finish = async (
    caseId: string | null,
    status: 'CREATED' | 'PARTIAL' | 'FAILED' | 'NEEDS_INPUT',
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
    ownerRef: row.entityId,
    ref: documentId,
    ...(stored.readFields ? { readFields: stored.readFields } : {}),
  })
  // Nothing to post, and retrying the same input cannot change that: the case
  // lacks an identifier only a person can supply. Wait for it rather than fail
  // and be retried until the sweep gives up.
  if (!payload) {
    return { ...(await finish(null, 'NEEDS_INPUT', mappingProblems, 0)), needs: handoffNeeds(stored) }
  }

  const start = (row.progress as CaseWriteProgress | null) ?? {
    ...emptyProgress(),
    caseId: row.nucleosCaseId,
  }
  let latest = start

  try {
    const written = await writeCase(payload, start, {
      onProgress: async progress => {
        // A case already linked to another organisation is theirs, whatever
        // Nucleos handed back. Refused before it is recorded here and before
        // anything is posted to it, so neither organisation sees the other's
        // goods.
        if (progress.caseId && progress.caseId !== latest.caseId) {
          const foreign = await db.cbamCaseLink.findFirst({
            where: { nucleosCaseId: progress.caseId, entityId: { not: row.entityId } },
            select: { documentId: true },
          })
          if (foreign) throw new ForeignCaseError()
        }
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
    if (err instanceof ForeignCaseError) return finish(null, 'FAILED', [...mappingProblems, err.message], 0)
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

export type SupplyIdentifiersResult =
  | { ok: true; outcome: CbamHandoffOutcome }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_WAITING'; message: string }
  | { ok: false; code: 'INVALID'; message: string; errors: { fieldName: string; message: string }[] }

/**
 * Supplies identifiers a waiting handoff lacks, then runs it.
 *
 * Only for a handoff waiting for input, only for the organisation that owns it,
 * and only to fill gaps — see `amendCaseIdentifiers`. The row is claimed by its
 * NEEDS_INPUT status so two submissions cannot both apply.
 */
export async function supplyCbamHandoffIdentifiers(
  input: { documentId: string; entityId: string; userId: string; amendments: CaseIdentifierAmendment[] },
  deps: Deps = {},
): Promise<SupplyIdentifiersResult> {
  const db = (deps.db ?? defaultPrisma) as PrismaClient
  const row = await db.cbamCaseLink.findUnique({ where: { documentId: input.documentId } })
  if (!row || row.entityId !== input.entityId) {
    return { ok: false, code: 'NOT_FOUND', message: 'There is no case waiting for this document.' }
  }
  const stored = row.handoffInput as StoredInput | null
  if (row.status !== 'NEEDS_INPUT' || !stored?.confirmed) {
    return { ok: false, code: 'NOT_WAITING', message: 'This case is not waiting for anything from you.' }
  }

  const amended = amendCaseIdentifiers(new Map(Object.entries(stored.confirmed)), input.amendments)
  if (!amended.confirmed) {
    return { ok: false, code: 'INVALID', message: 'Some of these could not be used.', errors: amended.errors }
  }

  const at = new Date().toISOString()
  const next: StoredInput = {
    ...stored,
    confirmed: Object.fromEntries(amended.confirmed),
    amendments: [
      ...(stored.amendments ?? []),
      ...input.amendments.map(a => ({
        fieldName: a.fieldName,
        value: amended.confirmed!.get(a.fieldName)!,
        byId: input.userId,
        at,
      })),
    ],
  }
  const claimed = await db.cbamCaseLink.updateMany({
    where: { documentId: input.documentId, status: { in: ['NEEDS_INPUT'] } },
    data: { handoffInput: next as unknown as Prisma.InputJsonValue, status: 'PENDING', problems: [] },
  })
  if (claimed.count === 0) {
    return { ok: false, code: 'NOT_WAITING', message: 'This case is not waiting for anything from you.' }
  }

  return { ok: true, outcome: await runCbamHandoff(input.documentId, deps) }
}
