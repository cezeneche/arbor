// Prints, as a JSON array, the storage path of every document record in
// Arbor's database: the files the documents backup must be able to recover.
// Read only, over the same verified TLS the app uses (src/lib/db-tls.ts).
//
// Required: SOURCE_URL (Arbor's backup login).
import pg from 'pg'
import { databaseConnection } from '../../src/lib/db-tls.ts'
import { toStoragePath } from '../../src/lib/storage-path.ts'

const url = process.env.SOURCE_URL
if (!url) {
  console.error('SOURCE_URL is required')
  process.exit(1)
}

const client = new pg.Client(databaseConnection(url))
await client.connect()
try {
  await client.query('BEGIN READ ONLY')
  const { rows } = await client.query('SELECT "blobUrl" FROM "Document"')
  await client.query('COMMIT')
  process.stdout.write(JSON.stringify(rows.map(r => toStoragePath(r.blobUrl))))
} finally {
  await client.end()
}
