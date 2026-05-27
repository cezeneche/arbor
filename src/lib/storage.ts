import { put, del } from '@vercel/blob'

export async function storeDocument(
  file: File,
  entityId: string
): Promise<{ url: string; pathname: string }> {
  const extension = file.name.split('.').pop()
  const pathname = `documents/${entityId}/${Date.now()}.${extension}`

  const blob = await put(pathname, file, {
    access: 'private',
    contentType: file.type,
  })

  return { url: blob.url, pathname: blob.pathname }
}

export async function deleteDocument(url: string): Promise<void> {
  await del(url)
}
