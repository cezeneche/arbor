import { getSupabaseAdmin, DOCUMENTS_BUCKET } from './supabase-admin'
import { toStoragePath } from './storage-path'

export async function fetchDocumentAsBase64(storedPath: string): Promise<{
  base64: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
}> {
  const supabase = getSupabaseAdmin()
  const path = toStoragePath(storedPath)

  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path)
  if (error || !data) throw new Error(`Failed to fetch document: ${error?.message ?? 'empty response'}`)

  const contentType = data.type
  const buffer = await data.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')

  const mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' =
    contentType.includes('pdf') ? 'application/pdf' :
    contentType.includes('png') ? 'image/png' :
    'image/jpeg'

  return { base64, mediaType }
}

/** A stored file's bytes, for serving it back to its owner. */
export async function fetchDocumentBytes(storedPath: string): Promise<Buffer> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(toStoragePath(storedPath))
  if (error || !data) throw new Error(`Failed to fetch document: ${error?.message ?? 'empty response'}`)
  return Buffer.from(await data.arrayBuffer())
}
