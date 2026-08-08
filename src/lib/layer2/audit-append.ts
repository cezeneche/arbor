// Layer 2 — the single way an entry is appended to an entity's audit chain.
//
// Every append has to answer two questions: which entry is the current tail (that
// supplies previousHash), and where does the new entry sit. Both used to be
// answered by createdAt, which cannot answer either — Postgres stamps every
// statement in one transaction with the same now(), so entries written together
// tie. AuditEntry.sequence answers both, and its unique constraint turns a
// concurrent double-append into a write conflict that runSerializable retries
// rather than a silently forked chain.
//
// Callers must run inside runSerializable(). Appending outside a serializable
// transaction can read a tail another transaction is about to claim.
import { computeRecordHash, type AuditPayload } from './audit-chain'
import type { Prisma } from '@prisma/client'

/** The narrowest client this needs: the tail lookup and the insert. Structural so
 *  a Prisma transaction client satisfies it and a test double can too. */
export interface AuditTxClient {
  auditEntry: {
    findFirst(args: {
      where: { entityId: string }
      orderBy: { sequence: 'desc' }
      select: { hash: true; sequence: true }
    }): Promise<{ hash: string; sequence: number } | null>
    create(args: {
      data: {
        entityId: string
        recordId: string
        eventType: string
        payload: Prisma.InputJsonValue
        hash: string
        previousHash: string | null
        sequence: number
      }
    }): Promise<unknown>
  }
}

export interface AuditAppendInput {
  entityId: string
  recordId: string
  eventType: string
  payload: AuditPayload
}

export interface AuditAppendResult {
  hash: string
  previousHash: string | null
  sequence: number
}

export async function appendAuditEntry(
  tx: AuditTxClient,
  input: AuditAppendInput,
): Promise<AuditAppendResult> {
  const tail = await tx.auditEntry.findFirst({
    where: { entityId: input.entityId },
    orderBy: { sequence: 'desc' },
    select: { hash: true, sequence: true },
  })

  const previousHash = tail?.hash ?? null
  const sequence = (tail?.sequence ?? 0) + 1
  const hash = computeRecordHash(input.payload, previousHash)

  await tx.auditEntry.create({
    data: {
      entityId: input.entityId,
      recordId: input.recordId,
      eventType: input.eventType,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      hash,
      previousHash,
      sequence,
    },
  })

  return { hash, previousHash, sequence }
}

/** The order the chain must be read in — for verification, export, or display. */
export const AUDIT_CHAIN_ORDER = { sequence: 'asc' } as const
