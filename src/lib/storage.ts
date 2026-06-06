import { getSupabaseAdmin, DOCUMENTS_BUCKET } from './supabase-admin'

export async function storeDocument(
  file: File,
  entityId: string
): Promise<{ url: string; pathname: string }> {
  const extension = file.name.split('.').pop() ?? 'bin'
  const pathname = `${entityId}/${Date.now()}.${extension}`

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(pathname, file, { contentType: file.type, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  return { url: pathname, pathname }
}

export async function deleteDocument(pathname: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  const path = storagePath(pathname)
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}

// Normalise a stored value (path or legacy full URL) to a bare storage path
function storagePath(urlOrPath: string): string {
  if (!urlOrPath.startsWith('http')) return urlOrPath
  // Supabase URL format: .../storage/v1/object/(public/)documents/{path}
  const match = urlOrPath.match(/\/object\/(?:public\/)?[^/]+\/(.+)$/)
  return match ? match[1] : urlOrPath
}
