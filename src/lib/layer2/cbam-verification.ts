// Layer 2 — a verifier's statement for a CBAM goods line: stored in Arbor,
// recorded in Nucleos by reference.
//
// Order matters. The file is stored and its row written before Nucleos is told,
// so a Nucleos failure never loses a statement — it is left unsynced and can be
// retried. Nucleos is never told about a file Arbor did not store. The status
// the returns read is Nucleos's; Arbor keeps the file, its hash, who uploaded
// it and who decided.

import { createHash } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { sniffFileType } from '@/lib/upload/sniff'
import type { SniffedType } from '@/lib/upload/sniff'
import { VerificationRejectedError, type StatementReference } from '@/lib/nucleos/verification-client'

/** Large enough for a scanned statement; small enough not to be something else. */
export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024

export interface VerificationDeps {
  db: Pick<PrismaClient, 'cbamVerificationStatement'>
  storeBytes: (bytes: Buffer, entityId: string, contentType: SniffedType) => Promise<{ pathname: string }>
  /** Nucleos's view of the line: its verification status and the hash it holds. */
  lineStatus: (caseId: string, goodsLineId: string) => Promise<{ status: string; reportHash: string | null }>
  nucleos: {
    request: (goodsLineId: string) => Promise<void>
    record: (goodsLineId: string, statement: StatementReference) => Promise<void>
    accept: (goodsLineId: string) => Promise<void>
    reject: (goodsLineId: string, reason: string) => Promise<void>
  }
  now?: () => Date
}

export type SubmitResult =
  | { ok: true; statementId: string; synced: boolean; problem: string | null }
  | { ok: false; code: 'NOT_PDF' | 'TOO_LARGE' | 'INVALID' | 'AWAITING_DECISION'; message: string }

export type DecideResult =
  { ok: true } | { ok: false; code: 'NOT_FOUND' | 'INVALID' | 'REFUSED' | 'UNAVAILABLE'; message: string }

export const statementRef = (statementId: string) => `arbor:verification:${statementId}`

function clean(value: string | undefined | null, max: number): string | null {
  const v = (value ?? '').trim()
  return v && v.length <= max ? v : null
}

/**
 * The checks every verifier's statement passes, whatever it verifies: a named,
 * accredited verifier and the verifier's own PDF.
 */
export function checkStatement(input: {
  bytes: Uint8Array
  verifierName: string
  verifierAccreditation: string
}):
  | { ok: true; verifierName: string; verifierAccreditation: string }
  | { ok: false; code: 'NOT_PDF' | 'TOO_LARGE' | 'INVALID'; message: string } {
  const verifierName = clean(input.verifierName, 200)
  const verifierAccreditation = clean(input.verifierAccreditation, 200)
  if (!verifierName || !verifierAccreditation) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Name the verifier and their accreditation, for example "UKAS 9876".',
    }
  }
  if (input.bytes.length === 0 || input.bytes.length > MAX_STATEMENT_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: 'The statement must be a PDF of up to 20 MB.' }
  }
  if (sniffFileType(input.bytes) !== 'application/pdf') {
    return { ok: false, code: 'NOT_PDF', message: 'The statement must be the verifier’s PDF.' }
  }
  return { ok: true, verifierName, verifierAccreditation }
}

export async function submitStatement(
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
  deps: VerificationDeps,
): Promise<SubmitResult> {
  const checked = checkStatement(input)
  if (!checked.ok) return checked
  const { verifierName, verifierAccreditation } = checked

  const waiting = await deps.db.cbamVerificationStatement.findFirst({
    where: {
      entityId: input.entityId,
      goodsLineId: input.goodsLineId,
      subject: 'EMISSIONS',
      status: 'SUBMITTED',
      syncedAt: { not: null },
    },
    select: { id: true },
  })
  if (waiting) {
    return {
      ok: false,
      code: 'AWAITING_DECISION',
      message: 'A statement for these goods is waiting to be accepted or rejected. Decide on it first.',
    }
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const { pathname } = await deps.storeBytes(Buffer.from(input.bytes), input.entityId, 'application/pdf')
  const row = await deps.db.cbamVerificationStatement.create({
    data: {
      entityId: input.entityId,
      nucleosCaseId: input.caseId,
      goodsLineId: input.goodsLineId,
      subject: 'EMISSIONS',
      storagePath: pathname,
      fileName: input.fileName.slice(0, 200) || 'statement.pdf',
      fileSize: input.bytes.length,
      sha256,
      verifierName,
      verifierAccreditation,
      uploadedById: input.userId,
    },
  })

  const synced = await syncStatement(row, deps)
  return { ok: true, statementId: row.id, synced: synced.ok, problem: synced.ok ? null : synced.message }
}

/**
 * Tells Nucleos about a stored statement. Safe to repeat: a statement Nucleos
 * already holds — the record landed but its response was lost — is recognised
 * by its hash and not sent again.
 */
export async function syncStatement(
  row: {
    id: string
    nucleosCaseId: string
    goodsLineId: string
    sha256: string
    verifierName: string
    verifierAccreditation: string
  },
  deps: VerificationDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = deps.now ?? (() => new Date())
  try {
    const line = await deps.lineStatus(row.nucleosCaseId, row.goodsLineId)
    const alreadyHeld = line.status === 'submitted' && line.reportHash === row.sha256
    if (!alreadyHeld) {
      if (line.status === 'not_required' || line.status === 'rejected') {
        await deps.nucleos.request(row.goodsLineId)
      }
      await deps.nucleos.record(row.goodsLineId, {
        verifierName: row.verifierName,
        verifierAccreditation: row.verifierAccreditation,
        documentRef: statementRef(row.id),
        sha256: row.sha256,
      })
    }
    await deps.db.cbamVerificationStatement.update({
      where: { id: row.id },
      data: { syncedAt: now(), syncError: null },
    })
    return { ok: true }
  } catch (err) {
    const message = `The statement is saved but could not be added to the case: ${(err as Error).message}`
    await deps.db.cbamVerificationStatement.update({
      where: { id: row.id },
      data: { syncError: message.slice(0, 500) },
    })
    return { ok: false, message }
  }
}

export async function decideStatement(
  input: {
    entityId: string
    userId: string
    goodsLineId: string
    statementId: string
    decision: 'accept' | 'reject'
    reason?: string
  },
  deps: VerificationDeps,
): Promise<DecideResult> {
  const now = deps.now ?? (() => new Date())
  const reason = input.decision === 'reject' ? clean(input.reason, 1000) : null
  if (input.decision === 'reject' && !reason) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Say why the statement is rejected — the reason is kept with it.',
    }
  }

  // Only a statement Nucleos has recorded and nobody has decided yet.
  const row = await deps.db.cbamVerificationStatement.findFirst({
    where: {
      id: input.statementId,
      entityId: input.entityId,
      goodsLineId: input.goodsLineId,
      subject: 'EMISSIONS',
      status: 'SUBMITTED',
      syncedAt: { not: null },
    },
  })
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'There is no statement waiting for a decision.' }

  try {
    if (input.decision === 'accept') await deps.nucleos.accept(row.goodsLineId)
    else await deps.nucleos.reject(row.goodsLineId, reason!)
  } catch (err) {
    if (err instanceof VerificationRejectedError) {
      return { ok: false, code: 'REFUSED', message: err.message }
    }
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: 'The case could not be updated just now. Try again shortly.',
    }
  }

  await deps.db.cbamVerificationStatement.update({
    where: { id: row.id },
    data: {
      status: input.decision === 'accept' ? 'ACCEPTED' : 'REJECTED',
      decidedById: input.userId,
      decidedAt: now(),
      rejectionReason: reason,
    },
  })
  return { ok: true }
}

/** The real collaborators: Prisma, the private documents bucket, and Nucleos. */
export async function defaultVerificationDeps(): Promise<VerificationDeps> {
  const [{ prisma }, { storeDocumentBytes }, { getCbamCase }, client] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/storage'),
    import('@/lib/nucleos/cases-client'),
    import('@/lib/nucleos/verification-client'),
  ])
  return {
    db: prisma,
    storeBytes: (bytes, entityId, contentType) => storeDocumentBytes(bytes, entityId, contentType),
    lineStatus: async (caseId, goodsLineId) => {
      const record = await getCbamCase(caseId)
      const line = (Array.isArray(record.goods_lines) ? record.goods_lines : []).find(
        (l: unknown) => (l as { id?: unknown })?.id === goodsLineId,
      ) as { verification_status?: unknown; verification_report_hash?: unknown } | undefined
      return {
        status: typeof line?.verification_status === 'string' ? line.verification_status : 'not_required',
        reportHash: typeof line?.verification_report_hash === 'string' ? line.verification_report_hash : null,
      }
    },
    nucleos: {
      request: goodsLineId => client.requestVerification(goodsLineId),
      record: (goodsLineId, statement) => client.recordVerificationStatement(goodsLineId, statement),
      accept: goodsLineId => client.acceptVerification(goodsLineId),
      reject: (goodsLineId, reason) => client.rejectVerification(goodsLineId, reason),
    },
  }
}
