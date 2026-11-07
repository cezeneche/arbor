// Layer 3 — Access. Pure, read-only. What a buyer sees of the flags on a
// supplier's record: the ones still open, and the ones the supplier settled by
// keeping the value with a note. A record replaced by a correction is inactive
// and never reaches a buyer, so a resolved flag with a note on an active record
// is a supplier standing by their value.

interface BuyerFlag {
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  message: string
  resolvedAt: Date | null
  resolvedNote: string | null
}

export function splitFlagsForBuyer<T extends BuyerFlag>(
  flags: readonly T[],
): { open: T[]; supplierNotes: { message: string; note: string }[] } {
  const open = flags.filter(f => f.resolvedAt === null)
  const supplierNotes = flags
    .filter(f => f.resolvedAt !== null && (f.resolvedNote ?? '').trim() !== '')
    .map(f => ({ message: f.message, note: (f.resolvedNote as string).trim() }))
  return { open, supplierNotes }
}
