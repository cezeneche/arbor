// Pure checks for the nightly restore drill (verify-restore.mjs). Each takes
// rows and returns the problems it found, in plain words; empty means sound.
//
// The drill does not recompute audit hashes: that needs AUDIT_CHAIN_SECRET,
// which can sign entries and so stays out of CI. Production's chains are
// verified live (/api/audit/[entityId]/verify). These prove the restored copy
// is whole and identical to production at the moment of the dump.

/** Every entity's chain starts at 1, has no gaps, and each entry links to the one before. */
export function chainProblems(entries) {
  const problems = []
  const byEntity = new Map()
  for (const e of entries) {
    if (!byEntity.has(e.entityId)) byEntity.set(e.entityId, [])
    byEntity.get(e.entityId).push(e)
  }
  for (const [entityId, chain] of byEntity) {
    chain.sort((a, b) => a.sequence - b.sequence)
    if (chain[0].sequence !== 1) problems.push(`${entityId}: chain starts at ${chain[0].sequence}, not 1`)
    else if (chain[0].previousHash !== null) {
      problems.push(`${entityId}: entry 1 links to a predecessor it cannot have`)
    }
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1]
      const cur = chain[i]
      for (let missing = prev.sequence + 1; missing < cur.sequence; missing++) {
        problems.push(`${entityId}: entry ${missing} is missing`)
      }
      if (cur.sequence === prev.sequence + 1 && cur.previousHash !== prev.hash) {
        problems.push(`${entityId}: entry ${cur.sequence} does not link to entry ${prev.sequence}`)
      }
    }
  }
  return problems
}

/** Every record's audit hash is the hash of one of its own chain entries. */
export function recordHashProblems(records, entries) {
  const hashesByRecord = new Map()
  for (const e of entries) {
    if (!hashesByRecord.has(e.recordId)) hashesByRecord.set(e.recordId, new Set())
    hashesByRecord.get(e.recordId).add(e.hash)
  }
  return records
    .filter(r => !hashesByRecord.get(r.id)?.has(r.auditHash))
    .map(r => `record ${r.id}: its audit hash is on none of its entries`)
}

/** Each entity's restored tail is byte-identical to production's entry at that position. */
export function tailProblems(restoredTails, sourceAtSamePositions) {
  const source = new Map(sourceAtSamePositions.map(s => [`${s.entityId}\u0000${s.sequence}`, s.hash]))
  const problems = []
  for (const t of restoredTails) {
    const hash = source.get(`${t.entityId}\u0000${t.sequence}`)
    if (hash === undefined) problems.push(`${t.entityId}: restored entry ${t.sequence} is not in production`)
    else if (hash !== t.hash)
      problems.push(`${t.entityId}: restored entry ${t.sequence} differs from production`)
  }
  return problems
}

/** Every production table is in the restore, with no more rows than production has now. */
export function countProblems(restored, source) {
  const rows = new Map(restored.map(r => [r.table, r.rows]))
  const problems = []
  for (const s of source) {
    const n = rows.get(s.table)
    if (n === undefined) problems.push(`${s.table}: missing from the restore`)
    else if (n > s.rows) problems.push(`${s.table}: ${n} rows restored, but production has ${s.rows}`)
  }
  return problems
}
