export async function fetchDocumentAsBase64(blobUrl: string): Promise<{
  base64: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
}> {
  const response = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })

  if (!response.ok) throw new Error(`Failed to fetch document: ${response.status}`)

  const contentType = response.headers.get('content-type') ?? ''
  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')

  const mediaType =
    contentType.includes('pdf') ? 'application/pdf' :
    contentType.includes('png') ? 'image/png' :
    'image/jpeg'

  return { base64, mediaType }
}
