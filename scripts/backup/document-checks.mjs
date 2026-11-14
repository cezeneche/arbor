// Pure decisions for the nightly backup of uploaded documents
// (backup-documents.sh). No network, no disk: each takes listings and returns
// what to do or what is wrong, in plain words.
//
// Files in the private `documents` bucket are never overwritten: every upload
// gets a new random name (src/lib/storage.ts, upsert: false). So a file that is
// already in the backup never needs copying again, and the backup only grows.

const PREFIX = 'documents/'

/** Where a stored file's encrypted copy lives in R2. Refuses a key that could escape documents/. */
export function backupKey(objectKey) {
  const unsafe =
    typeof objectKey !== 'string' ||
    objectKey === '' ||
    objectKey.startsWith('/') ||
    objectKey.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(objectKey) ||
    objectKey.split('/').some(part => part === '..' || part === '.')
  if (unsafe) throw new Error(`unsafe object key: ${JSON.stringify(objectKey)}`)
  return `${PREFIX}${objectKey}.age`
}

/** The stored files with no copy in the backup yet, by key. Folder placeholders are not files. */
export function toCopy(sourceObjects, backedUpKeys) {
  const have = new Set(backedUpKeys)
  return sourceObjects
    .filter(o => !o.key.endsWith('/'))
    .filter(o => !have.has(backupKey(o.key)))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * Every document record's file must be recoverable from the backup. A file that
 * has left storage but is in the backup is covered: the backup is what
 * recovers it. Files with no record (abandoned uploads) are copied but not required.
 */
export function coverageProblems({ documentPaths, sourceKeys, backedUpKeys }) {
  const inStorage = new Set(sourceKeys)
  const inBackup = new Set(backedUpKeys)
  const problems = []
  for (const path of [...new Set(documentPaths)].sort()) {
    if (inBackup.has(backupKey(path))) continue
    problems.push(
      inStorage.has(path)
        ? `${path}: the file is in storage but not in the backup`
        : `${path}: a document record points at a file that is not in storage`,
    )
  }
  return problems
}

/** A download that is not the size storage lists is never stored as the document. */
export function sizeProblem(key, listedBytes, downloadedBytes) {
  return listedBytes === downloadedBytes
    ? null
    : `${key}: downloaded ${downloadedBytes} bytes, storage lists ${listedBytes}`
}
