// What a goods line says about the verification of its emissions figure, and
// the one action it offers. Pure.
//
// A supplier's figure goes on a return as actual, verified data only once an
// accredited verifier's statement has been accepted; otherwise it is reported
// as unverified. Nucleos holds the status (not_required → pending → submitted
// → verified | rejected). Arbor holds the statement itself — the file, who
// uploaded it, who decided — and whether Nucleos has been told about it yet.

export interface StatementSummary {
  id: string
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED'
  verifierName: string
  verifierAccreditation: string
  uploadedByName: string | null
  uploadedAt: string
  decidedByName: string | null
  rejectionReason: string | null
  /** False when the file is stored but Nucleos has not recorded it. */
  syncedToNucleos: boolean
}

export interface LineVerificationInput {
  /** The emissions method on the line: actual, estimated, default, or none yet. */
  method: string | null | undefined
  /** Nucleos's verification_status for the line. */
  status: string | null | undefined
  verifierName?: string | null
  verifierAccreditation?: string | null
}

export type VerificationState = 'unverified' | 'unsynced' | 'received' | 'verified' | 'rejected'
export type VerificationAction = 'upload' | 'decide' | 'retry' | null

export interface PresentedVerification {
  applicable: boolean
  state: VerificationState | null
  label: string
  detail: string | null
  action: VerificationAction
  statementId: string | null
}

const SUPPLIER_METHODS = new Set(['actual', 'estimated'])

const NOT_APPLICABLE: PresentedVerification = {
  applicable: false,
  state: null,
  label: '',
  detail: null,
  action: null,
  statementId: null,
}

function verifier(name: string | null | undefined, accreditation: string | null | undefined): string {
  const n = (name ?? '').trim()
  const a = (accreditation ?? '').trim()
  return a ? `${n} (${a})` : n
}

export function presentVerification(
  line: LineVerificationInput,
  latest: StatementSummary | null,
): PresentedVerification {
  // Only a supplier's own figure is verified. A published default needs no
  // statement, and a line with no figure has nothing to verify yet.
  if (!SUPPLIER_METHODS.has(String(line.method ?? '').toLowerCase())) return NOT_APPLICABLE

  if (latest && !latest.syncedToNucleos) {
    return {
      applicable: true,
      state: 'unsynced',
      label: 'Statement saved, not yet added to the case',
      detail: 'The file is stored safely. Try again to add it to the case.',
      action: 'retry',
      statementId: latest.id,
    }
  }

  const status = String(line.status ?? 'not_required').toLowerCase()

  if (status === 'verified') {
    return {
      applicable: true,
      state: 'verified',
      label: `Verified by ${verifier(line.verifierName ?? latest?.verifierName, line.verifierAccreditation ?? latest?.verifierAccreditation)}`,
      detail: latest?.decidedByName ? `Accepted by ${latest.decidedByName}.` : null,
      action: null,
      statementId: latest?.id ?? null,
    }
  }

  if (status === 'submitted' && latest) {
    return {
      applicable: true,
      state: 'received',
      label: 'Verifier’s statement received',
      detail:
        `From ${verifier(latest.verifierName, latest.verifierAccreditation)}. ` +
        'Check it matches this supplier and these goods, then accept or reject it.',
      action: 'decide',
      statementId: latest.id,
    }
  }

  if (status === 'rejected') {
    return {
      applicable: true,
      state: 'rejected',
      label: 'Statement rejected',
      detail: latest?.rejectionReason
        ? `${latest.rejectionReason} Add another statement to try again.`
        : 'Add another statement to try again.',
      action: 'upload',
      statementId: latest?.id ?? null,
    }
  }

  return {
    applicable: true,
    state: 'unverified',
    label: 'Not verified',
    detail:
      'The supplier’s figure will be reported as unverified. Add the accredited verifier’s ' +
      'statement to report it as verified.',
    action: 'upload',
    statementId: null,
  }
}

export interface StatementRow {
  id: string
  goodsLineId: string
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED'
  verifierName: string
  verifierAccreditation: string
  uploadedById: string
  uploadedAt: Date
  decidedById: string | null
  rejectionReason: string | null
  syncedAt: Date | null
}

/** The newest statement for each goods line, with the people's names resolved. */
export function latestStatements(
  rows: readonly StatementRow[],
  names: ReadonlyMap<string, string>,
): Map<string, StatementSummary> {
  const latest = new Map<string, StatementRow>()
  for (const row of rows) {
    const current = latest.get(row.goodsLineId)
    if (!current || row.uploadedAt > current.uploadedAt) latest.set(row.goodsLineId, row)
  }
  return new Map(
    [...latest].map(([goodsLineId, row]) => [
      goodsLineId,
      {
        id: row.id,
        status: row.status,
        verifierName: row.verifierName,
        verifierAccreditation: row.verifierAccreditation,
        uploadedByName: names.get(row.uploadedById) ?? null,
        uploadedAt: row.uploadedAt.toISOString(),
        decidedByName: row.decidedById ? (names.get(row.decidedById) ?? null) : null,
        rejectionReason: row.rejectionReason,
        syncedToNucleos: row.syncedAt !== null,
      },
    ]),
  )
}
