// Whether the reviewer is told the document was only partly read. Pure: no DB,
// no network.
//
// A reviewer confirming fields sets the provenance tier for the record, and
// they do that on the assumption that what they are looking at is the whole
// document. When the source was truncated that assumption is wrong and nothing
// on the screen says so — the extracted fields look exactly the same as a
// complete read. Failed extraction is visible; a partial one is not, which is
// what makes it the more dangerous of the two.
//
// The notice fires on the flag alone. Inferring truncation from the reason text
// would mean a job that recorded a reason without setting the flag silently
// passes, which is the failure this exists to prevent.

export interface TruncationState {
  truncated: boolean
  truncationReason: string | null
}

export interface TruncationNotice {
  /** What was cut, as recorded by the extractor. */
  reason: string
  /** The full warning shown above the field list. */
  message: string
}

const REASON_UNRECORDED = 'The reason was not recorded.'

export function truncationNotice(job: TruncationState | null): TruncationNotice | null {
  if (!job?.truncated) return null

  const reason = job.truncationReason?.trim() || REASON_UNRECORDED

  return {
    reason,
    message:
      `Part of this document has not been read: ${reason} ` +
      `Anything you confirm below covers only the part that was read.`,
  }
}
