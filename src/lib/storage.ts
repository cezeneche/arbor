import { randomUUID } from 'crypto'
import { getSupabaseAdmin, DOCUMENTS_BUCKET } from './supabase-admin'
import { toStoragePath } from './storage-path'
import type { SniffedType } from './upload/sniff'
import { extensionForType } from './upload/sniff'

export async function storeDocument(
  file: File,
  entityId: string,
  // The server-sniffed content type. Drives both the stored contentType and the
  // extension, so a spoofed filename/MIME can't influence the stored object.
  contentType: SniffedType,
): Promise<{ url: string; pathname: string }> {
  // UUID (not Date.now()) removes any same-millisecond collision within an entity.
  const pathname = `${entityId}/${randomUUID()}.${extensionForType(contentType)}`

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(pathname, file, { contentType, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  return { url: pathname, pathname }
}

// Buffer variant of storeDocument for pipelines that already hold the raw bytes
// (email inbound, connectors) rather than a File. Same private bucket and
// server-sniffed contentType — never public blob storage.
export async function storeDocumentBytes(
  bytes: Buffer,
  entityId: string,
  contentType: SniffedType,
): Promise<{ url: string; pathname: string }> {
  const pathname = `${entityId}/${randomUUID()}.${extensionForType(contentType)}`

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(pathname, bytes, { contentType, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  return { url: pathname, pathname }
}

export async function deleteDocument(pathname: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([toStoragePath(pathname)])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}
