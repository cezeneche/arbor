// Layer 2 — the verifier's statement behind a carbon price relief claim:
// stored in Arbor, recorded in Nucleos by reference.
//
// The same order as the emissions statement: the file is stored and its row
// written before Nucleos is told, so a Nucleos failure never loses a statement.
// It differs in what it attaches to. Nucleos records a relief statement on the
// line's claims that have none, and only the newest claim counts on the return
// — so a statement is taken only while that claim is waiting for one. There is
// no accept or reject step: relief statements have no lifecycle in Nucleos.

import { createHash } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import type { SniffedType } from '@/lib/upload/sniff'
import { VerificationRejectedError } from '@/lib/nucleos/verification-client'
import type { ReliefClaim } from '@/lib/nucleos/relief-client'
import { checkStatement, statementRef } from './cbam-verification'

export interface ReliefStatementDeps {
  db: { cbamVerificationStatement: Pick<PrismaClient['cbamVerificationStatement'], 'create' | 'update'> }
  storeBytes: (bytes: Buffer, entityId: string, contentType: SniffedType) => Promise<{ pathname: string }>
  claims: (goodsLineId: string) => Promise<Pick<ReliefClaim, 'created_at' | 'verification_document_hash'>[]>
  record: (goodsLineId: string, statement: { documentRef: string; sha256: string }) => Promise<void>
  now?: () => Date
}

export type ReliefSubmitResult =
  | { ok: true; statementId: string; synced: boolean; problem: string | null }
  | { ok: false; code: 'NOT_PDF' | 'TOO_LARGE' | 'INVALID' | 'REFUSED' | 'UNAVAILABLE'; message: string }

function newest<T extends { created_at?: string | null }>(claims: readonly T[]): T | undefined {
  return [...claims].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
}

export async function submitReliefStatement(
  input: {
    entityId: string
    userId: string
    caseId: string
    goodsLineId: string
    bytes: Uint8Array
    fileName: string
    verifierName: string
    verifierAccreditation: string
  },
  deps: ReliefStatementDeps,
): Promise<ReliefSubmitResult> {
  const checked = checkStatement(input)
  if (!checked.ok) return checked

  let claims: Awaited<ReturnType<ReliefStatementDeps['claims']>>
  try {
    claims = await deps.claims(input.goodsLineId)
  } catch {
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: 'The relief claims could not be read just now. Try again shortly.',
    }
  }
  const counting = newest(claims)
  if (!counting) {
    return {
      ok: false,
      code: 'REFUSED',
      message: 'Record the relief claim first. The statement is attached to it.',
    }
  }
  if (counting.verification_document_hash) {
    return {
      ok: false,
      code: 'REFUSED',
      message: 'The claim that counts already has a verifier’s statement. Claim again to attach a new one.',
    }
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const { pathname } = await deps.storeBytes(Buffer.from(input.bytes), input.entityId, 'application/pdf')
  const row = await deps.db.cbamVerificationStatement.create({
    data: {
      entityId: input.entityId,
      nucleosCaseId: input.caseId,
      goodsLineId: input.goodsLineId,
      subject: 'RELIEF',
      storagePath: pathname,
      fileName: input.fileName.slice(0, 200) || 'statement.pdf',
      fileSize: input.bytes.length,
      sha256,
      verifierName: checked.verifierName,
      verifierAccreditation: checked.verifierAccreditation,
      uploadedById: input.userId,
    },
  })

  const synced = await syncReliefStatement(row, deps)
  return { ok: true, statementId: row.id, synced: synced.ok, problem: synced.ok ? null : synced.message }
}

/**
 * Tells Nucleos about a stored relief statement. Safe to repeat: a statement a
 * claim already carries is recognised by its hash and not sent again.
 */
export async function syncReliefStatement(
  row: { id: string; goodsLineId: string; sha256: string },
  deps: ReliefStatementDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = deps.now ?? (() => new Date())
  try {
    const claims = await deps.claims(row.goodsLineId)
    if (!claims.some(c => c.verification_document_hash === row.sha256)) {
      await deps.record(row.goodsLineId, { documentRef: statementRef(row.id), sha256: row.sha256 })
    }
    await deps.db.cbamVerificationStatement.update({
      where: { id: row.id },
      data: { syncedAt: now(), syncError: null },
    })
    return { ok: true }
  } catch (err) {
    const reason = err instanceof VerificationRejectedError ? err.message : (err as Error).message
    const message = `The statement is saved but could not be added to the claim: ${reason}`
    await deps.db.cbamVerificationStatement.update({
      where: { id: row.id },
      data: { syncError: message.slice(0, 500) },
    })
    return { ok: false, message }
  }
}

/** The real collaborators: Prisma, the private documents bucket, and Nucleos. */
export async function defaultReliefStatementDeps(): Promise<ReliefStatementDeps> {
  const [{ prisma }, { storeDocumentBytes }, client] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/storage'),
    import('@/lib/nucleos/relief-client'),
  ])
  return {
    db: prisma,
    storeBytes: (bytes, entityId, contentType) => storeDocumentBytes(bytes, entityId, contentType),
    claims: goodsLineId => client.listReliefClaims(goodsLineId),
    record: (goodsLineId, statement) => client.recordReliefStatement(goodsLineId, statement),
  }
}
