// Normalise a stored blob reference (a bare storage path or a legacy full Supabase
// URL) to the bare object path the storage client expects. Shared by the upload and
// retrieval helpers so the URL-parsing rule lives in exactly one place.
export function toStoragePath(urlOrPath: string): string {
  if (!urlOrPath.startsWith('http')) return urlOrPath
  // Supabase object URL: .../storage/v1/object/(public/)<bucket>/<path>
  const match = urlOrPath.match(/\/object\/(?:public\/)?[^/]+\/(.+)$/)
  return match ? match[1] : urlOrPath
}
