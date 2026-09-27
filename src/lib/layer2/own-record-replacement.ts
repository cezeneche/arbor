// Layer 2 — what a confirmation does to records its own document already wrote.
// Pure: decides, writes nothing.
//
// A document can hold active records before a person confirms it: auto-accepted
// ones are saved Declared straight away, and the constraint gate can send an
// auto-accepted document back to review with its records still written. The
// confirmation replaces them. Matching on the exact period missed whenever the
// reviewer's corrections moved it, and "keep both" skipped supersession
// altogether — either way the document ended up counted twice.

export interface OwnRecordReplacement {
  /** Field → this document's earlier records the new record for that field supersedes. */
  supersedeByField: Map<string, string[]>
  /** Earlier records whose field the confirmation no longer carries: the reviewer
   *  cleared it, so nothing replaces them and they are withdrawn. */
  withdraw: string[]
}

export function planOwnRecordReplacement(
  own: readonly { id: string; fieldName: string }[],
  submittedFieldNames: readonly string[],
): OwnRecordReplacement {
  const submitted = new Set(submittedFieldNames)
  const supersedeByField = new Map<string, string[]>()
  const withdraw: string[] = []
  for (const record of own) {
    if (submitted.has(record.fieldName)) {
      supersedeByField.set(record.fieldName, [...(supersedeByField.get(record.fieldName) ?? []), record.id])
    } else {
      withdraw.push(record.id)
    }
  }
  return { supersedeByField, withdraw }
}
