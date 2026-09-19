// Layer 2 — idempotent batch ingestion.
//
// An idempotency key is reserved before any record is written, as a unique
// (entityId, idempotencyKey) row carrying a digest of the request. Each item's
// outcome is then committed in the same transaction as its record, so after a
// crash the row says exactly which items landed and a retry writes only the
// rest. A completed batch replays its original per-item response.
//
// The marker this replaces was an audit entry written after the whole batch: a
// crash between the last record and the marker duplicated every record on the
// retry, and two copies of one request in flight both passed the check.
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

/** An IN_PROGRESS batch untouched this long was abandoned, and may be resumed. */
export const STALE_MS = 5 * 60 * 1000

export type ItemResult = { index: number; status: string; [k: string]: unknown }
type Results = Record<string, ItemResult>

type Db = Pick<PrismaClient, 'ingestOperation'> | Pick<Prisma.TransactionClient, 'ingestOperation'>

export type Reservation =
  | { kind: 'new'; id: string; done: Results }
  | { kind: 'resume'; id: string; done: Results }
  | { kind: 'replay'; results: Results }
  | { kind: 'conflict' }
  | { kind: 'in_progress' }

/** Stable across key order, so a re-serialised identical request matches. */
export function requestDigest(records: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, stable((v as Record<string, unknown>)[k])]))
        : v
  return createHash('sha256').update(JSON.stringify(stable(records))).digest('hex')
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002'
}

export async function reserveIngestOperation(
  db: Db,
  entityId: string,
  idempotencyKey: string,
  digest: string,
): Promise<Reservation> {
  try {
    const op = await db.ingestOperation.create({
      data: { entityId, idempotencyKey, requestDigest: digest },
    })
    return { kind: 'new', id: op.id, done: {} }
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }

  const existing = await db.ingestOperation.findUnique({
    where: { entityId_idempotencyKey: { entityId, idempotencyKey } },
  })
  if (!existing) return { kind: 'in_progress' }
  if (existing.requestDigest !== digest) return { kind: 'conflict' }
  if (existing.status === 'COMPLETE') {
    return { kind: 'replay', results: (existing.results ?? {}) as Results }
  }

  // Take over a released batch, or one abandoned mid-way. Only one caller wins.
  const taken = await db.ingestOperation.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: 'PARTIAL' },
        { status: 'IN_PROGRESS', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
      ],
    },
    data: { status: 'IN_PROGRESS' },
  })
  if (taken.count === 0) return { kind: 'in_progress' }
  return { kind: 'resume', id: existing.id, done: (existing.results ?? {}) as Results }
}

/**
 * Records one item's outcome. Call in the same transaction as the item's record
 * write, so the record and the fact that it landed commit together. When the
 * item is already recorded, returns that outcome and the caller writes nothing.
 */
export async function claimItem(
  tx: Db,
  operationId: string,
  index: number,
  result: ItemResult,
): Promise<{ alreadyDone: false } | { alreadyDone: true; result: ItemResult }> {
  const op = await tx.ingestOperation.findUnique({ where: { id: operationId } })
  const results = ((op?.results ?? {}) as Results)
  const prior = results[String(index)]
  if (prior) return { alreadyDone: true, result: prior }
  await tx.ingestOperation.update({
    where: { id: operationId },
    data: { results: { ...results, [String(index)]: result } as Prisma.InputJsonValue },
  })
  return { alreadyDone: false }
}

export async function completeIngestOperation(db: Db, operationId: string, results: Results): Promise<void> {
  await db.ingestOperation.update({
    where: { id: operationId },
    data: { status: 'COMPLETE', results: results as Prisma.InputJsonValue },
  })
}

/**
 * Ends this attempt without completing the batch: some items failed for a reason
 * that may pass — a dropped connection, a full plan. The items that landed stay
 * recorded, and the next call with the key resumes straight away rather than
 * replaying a failure forever.
 */
export async function releaseIngestOperation(db: Db, operationId: string): Promise<void> {
  await db.ingestOperation.update({
    where: { id: operationId },
    data: { status: 'PARTIAL' },
  })
}
