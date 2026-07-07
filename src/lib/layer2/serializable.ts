// Layer 2 — serializable transaction runner with write-conflict retry.
//
// The per-entity audit chain requires Serializable isolation: previousHash is read
// inside the transaction, so two concurrent writes to the same entity must not both
// see the same tail. Postgres enforces this by aborting one with a serialization
// failure (Prisma error code P2034). Without a retry the loser surfaces a raw 500
// and its write is lost, so every audit-chain write path runs through this wrapper.
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

type TxClient = Prisma.TransactionClient

/** Prisma maps Postgres 40001 (serialization) and 40P01 (deadlock) to P2034. */
export function isWriteConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
}

export interface RunSerializableOptions {
  /** Total attempts including the first. */
  retries?: number
  /** Base backoff in ms; each retry waits base * 2^attempt plus jitter. */
  backoffMs?: number
  /** Injectable client, for tests. Defaults to the shared prisma singleton. */
  client?: Pick<PrismaClient, '$transaction'>
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run `fn` inside a Serializable transaction, retrying only on write-conflict
 * (P2034) with exponential backoff + jitter. Any other error — including
 * application control-flow errors thrown inside `fn` — propagates immediately.
 */
export async function runSerializable<T>(
  fn: (tx: TxClient) => Promise<T>,
  opts: RunSerializableOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3
  const backoffMs = opts.backoffMs ?? 25
  const client = opts.client ?? prisma
  const sleep = opts.sleep ?? defaultSleep

  let lastErr: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await client.$transaction(fn, { isolationLevel: 'Serializable' })
    } catch (err) {
      if (!isWriteConflict(err)) throw err
      lastErr = err
      if (attempt < retries - 1) {
        const jitter = Math.floor(Math.random() * backoffMs)
        await sleep(backoffMs * 2 ** attempt + jitter)
      }
    }
  }
  throw lastErr
}
