import { execFileSync } from 'node:child_process'

// The nightly restore drill (scripts/backup/verify-restore.mjs) proves a backup
// is an intact copy of production without holding AUDIT_CHAIN_SECRET, which
// stays out of CI because it can sign entries. Recomputing hashes is the live
// verifier's job; the drill checks the restored data is whole and identical:
// every chain gapless and linked, every record's hash on an entry, and each
// entity's restored tail byte-identical to production's entry at that position.
//
// The checks are a plain module the workflow runs with node, so they are
// exercised here the way the workflow runs them.

function check<T>(fn: string, ...args: unknown[]): T {
  const code = `import(${JSON.stringify(`${process.cwd()}/scripts/backup/restore-checks.mjs`)}).then(m =>
    process.stdout.write(JSON.stringify(m.${fn}(...JSON.parse(process.argv[1])))))`
  return JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', code, JSON.stringify(args)], { encoding: 'utf8' }),
  )
}

const entry = (entityId: string, sequence: number, hash: string, previousHash: string | null) => ({
  entityId,
  sequence,
  hash,
  previousHash,
})

describe('chainProblems', () => {
  it('accepts whole, linked chains', () => {
    const entries = [entry('a', 1, 'h1', null), entry('a', 2, 'h2', 'h1'), entry('b', 1, 'k1', null)]
    expect(check('chainProblems', entries)).toEqual([])
  })

  it('reports a chain that does not start at 1', () => {
    expect(check<string[]>('chainProblems', [entry('a', 2, 'h2', null)])).toEqual([
      'a: chain starts at 2, not 1',
    ])
  })

  it('reports a missing entry', () => {
    const entries = [entry('a', 1, 'h1', null), entry('a', 3, 'h3', 'h1')]
    expect(check('chainProblems', entries)).toEqual(['a: entry 2 is missing'])
  })

  it('reports an entry that does not link to the one before it', () => {
    const entries = [entry('a', 1, 'h1', null), entry('a', 2, 'h2', 'other')]
    expect(check('chainProblems', entries)).toEqual(['a: entry 2 does not link to entry 1'])
  })

  it('reports a first entry that claims a predecessor', () => {
    expect(check('chainProblems', [entry('a', 1, 'h1', 'h0')])).toEqual([
      'a: entry 1 links to a predecessor it cannot have',
    ])
  })
})

describe('recordHashProblems', () => {
  it('accepts records whose hash is on one of their entries', () => {
    const records = [{ id: 'r1', auditHash: 'h1' }]
    const entries = [
      { recordId: 'r1', hash: 'h1' },
      { recordId: 'r1', hash: 'h9' },
    ]
    expect(check('recordHashProblems', records, entries)).toEqual([])
  })

  it('reports a record whose hash is on none of its entries', () => {
    const records = [{ id: 'r1', auditHash: 'h1' }]
    expect(check('recordHashProblems', records, [{ recordId: 'r1', hash: 'other' }])).toEqual([
      'record r1: its audit hash is on none of its entries',
    ])
  })
})

describe('tailProblems', () => {
  it('accepts restored tails identical to production at the same position', () => {
    const tails = [{ entityId: 'a', sequence: 2, hash: 'h2' }]
    expect(check('tailProblems', tails, [{ entityId: 'a', sequence: 2, hash: 'h2' }])).toEqual([])
  })

  it('reports a tail that differs from production', () => {
    const tails = [{ entityId: 'a', sequence: 2, hash: 'h2' }]
    expect(check('tailProblems', tails, [{ entityId: 'a', sequence: 2, hash: 'x' }])).toEqual([
      'a: restored entry 2 differs from production',
    ])
  })

  it('reports a tail production does not have', () => {
    expect(check('tailProblems', [{ entityId: 'a', sequence: 2, hash: 'h2' }], [])).toEqual([
      'a: restored entry 2 is not in production',
    ])
  })
})

describe('countProblems', () => {
  it('accepts a restore with every table and no more rows than production', () => {
    const restored = [{ table: 'public.DataRecord', rows: 10 }]
    expect(check('countProblems', restored, [{ table: 'public.DataRecord', rows: 12 }])).toEqual([])
  })

  it('reports a table missing from the restore', () => {
    expect(check('countProblems', [], [{ table: 'public.DataRecord', rows: 12 }])).toEqual([
      'public.DataRecord: missing from the restore',
    ])
  })

  it('reports more rows than production has', () => {
    const restored = [{ table: 'public.DataRecord', rows: 13 }]
    expect(check('countProblems', restored, [{ table: 'public.DataRecord', rows: 12 }])).toEqual([
      'public.DataRecord: 13 rows restored, but production has 12',
    ])
  })
})
