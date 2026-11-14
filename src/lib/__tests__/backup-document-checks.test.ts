import { execFileSync } from 'node:child_process'

// The nightly backup of uploaded documents (scripts/backup/backup-documents.sh)
// copies each file in the private `documents` bucket to R2 once, encrypted to
// the owner's age key. Files are never overwritten (each upload gets a new
// random name), so a file already in the backup never needs copying again.
// The decisions live in scripts/backup/document-checks.mjs and are exercised
// here the way the workflow runs them, as a plain module under node.

function check<T>(fn: string, ...args: unknown[]): T {
  const code = `import(${JSON.stringify(`${process.cwd()}/scripts/backup/document-checks.mjs`)}).then(m => {
    try { process.stdout.write(JSON.stringify({ ok: m.${fn}(...JSON.parse(process.argv[1])) })) }
    catch (e) { process.stdout.write(JSON.stringify({ error: e.message })) }
  })`
  const out = JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', code, JSON.stringify(args)], { encoding: 'utf8' }),
  )
  if ('error' in out) throw new Error(out.error)
  return out.ok
}

describe('backupKey', () => {
  // Expected: documents/<key>.age. Reason: outside daily/, whose 35-day
  // lifecycle rule would delete evidence the records still point at.
  it('puts each file under documents/, encrypted', () => {
    expect(check('backupKey', 'entity-1/3f2a.pdf')).toBe('documents/entity-1/3f2a.pdf.age')
  })

  // Expected: refusal. Reason: a key that climbs out of documents/ could
  // overwrite a database backup in the same bucket.
  it.each(['', '/abs.pdf', 'a/../b.pdf', '..', 'a\\b.pdf', 'a/\nb.pdf'])('refuses an unsafe key: %j', key => {
    expect(() => check('backupKey', key)).toThrow(/unsafe/)
  })
})

describe('toCopy', () => {
  const source = [
    { key: 'e1/b.pdf', size: 20 },
    { key: 'e1/a.pdf', size: 10 },
    { key: 'e2/c.png', size: 30 },
  ]

  // Expected: only the files not yet in the backup, in a stable order.
  // Reason: files never change, so one copy is enough, and a stable order
  // makes a failed run easy to compare with the next.
  it('copies only what is not backed up yet', () => {
    expect(check('toCopy', source, ['documents/e1/a.pdf.age'])).toEqual([
      { key: 'e1/b.pdf', size: 20 },
      { key: 'e2/c.png', size: 30 },
    ])
  })

  it('copies nothing when everything is backed up', () => {
    const all = source.map(o => `documents/${o.key}.age`)
    expect(check('toCopy', source, all)).toEqual([])
  })

  // Expected: folder markers skipped. Reason: S3 listings can include
  // zero-byte "folder/" placeholders, which are not documents.
  it('skips folder placeholders', () => {
    expect(check('toCopy', [{ key: 'e1/', size: 0 }], [])).toEqual([])
  })
})

describe('coverageProblems', () => {
  // Expected: no problems. Reason: every document record's file is in storage
  // and in the backup.
  it('accepts full coverage', () => {
    expect(
      check('coverageProblems', {
        documentPaths: ['e1/a.pdf'],
        sourceKeys: ['e1/a.pdf', 'e1/orphan.pdf'],
        backedUpKeys: ['documents/e1/a.pdf.age', 'documents/e1/orphan.pdf.age'],
      }),
    ).toEqual([])
  })

  // Expected: named, in plain words. Reason: either gap means a record's
  // evidence could not be recovered, which is what the job exists to prevent.
  it('names a document whose file is not in the backup', () => {
    expect(
      check('coverageProblems', {
        documentPaths: ['e1/a.pdf'],
        sourceKeys: ['e1/a.pdf'],
        backedUpKeys: [],
      }),
    ).toEqual(['e1/a.pdf: the file is in storage but not in the backup'])
  })

  it('names a document whose file is missing from storage', () => {
    expect(
      check('coverageProblems', {
        documentPaths: ['e1/gone.pdf'],
        sourceKeys: [],
        backedUpKeys: [],
      }),
    ).toEqual(['e1/gone.pdf: a document record points at a file that is not in storage'])
  })

  // Expected: a file that is still in the backup counts as covered even after
  // it left storage. Reason: the backup is what recovers it.
  it('accepts a file that left storage but is in the backup', () => {
    expect(
      check('coverageProblems', {
        documentPaths: ['e1/a.pdf'],
        sourceKeys: [],
        backedUpKeys: ['documents/e1/a.pdf.age'],
      }),
    ).toEqual([])
  })
})

describe('sizeProblem', () => {
  // Expected: a mismatch is named. Reason: a short download must never be
  // encrypted and stored as if it were the document.
  it('names a download of the wrong size', () => {
    expect(check('sizeProblem', 'e1/a.pdf', 100, 99)).toBe('e1/a.pdf: downloaded 99 bytes, storage lists 100')
  })

  it('accepts the listed size', () => {
    expect(check('sizeProblem', 'e1/a.pdf', 100, 100)).toBeNull()
  })
})

describe('failure alert', () => {
  // Expected: its own wording, not "database backup". Reason: the ops channel
  // must be told which copy is missing.
  it('says the documents backup failed', () => {
    const out = execFileSync('python3', ['scripts/backup/notify_failure.py'], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '',
        BACKUP_ALERT_DRY_RUN: '1',
        KIND: 'documents',
        RUN_URL: 'https://github.com/cezeneche/arbor/actions/runs/2',
      },
    })
    const text = out
    expect(text).toContain('Uploaded documents backup failed')
    expect(text).toContain('no new copy outside Supabase')
    expect(text).not.toContain('database backup failed')
  })
})
