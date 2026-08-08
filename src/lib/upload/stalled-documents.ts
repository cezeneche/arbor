// Pure rules for what to do with a document stuck in a working state. No DB, no
// AI, no side effects — the sweeper wires this to Prisma.

/** How long a document may sit in a working state before it is treated as
 *  stalled. Extraction makes several model calls, so the window has to be wide
 *  enough that a slow-but-live run is never disturbed. */
export const STALLED_AFTER_MINUTES = 30

export type StalledAction = 'REQUEUE' | 'MARK_FOR_REVIEW'

/**
 * PENDING with no extraction job means the run never started at all — most
 * likely the enqueue failed after the file was stored. Nothing has been written,
 * so it is safe to ask for the work again.
 *
 * Anything else — EXTRACTING, or PENDING with a job already on record — means a
 * run began and did not finish. Re-queueing that could duplicate whatever it had
 * already done, so it is handed to the user instead, which is also the honest
 * answer: something went wrong and somebody should look.
 */
export function classifyStalledDocument(doc: {
  status: string
  hasExtractionJob: boolean
}): StalledAction {
  if (doc.status === 'PENDING' && !doc.hasExtractionJob) return 'REQUEUE'
  return 'MARK_FOR_REVIEW'
}
