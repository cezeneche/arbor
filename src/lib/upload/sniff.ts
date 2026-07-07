// Content-type sniffing from the leading bytes of an uploaded file. The client's
// declared MIME type is attacker-controlled, so the storage/extraction pipeline
// trusts the magic number instead. Only the three ingestible types are recognised;
// anything else returns null and is rejected upstream.

export type SniffedType = 'application/pdf' | 'image/jpeg' | 'image/png'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // %PDF
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

/** Identify PDF/JPEG/PNG from the header bytes, or null if unrecognised. */
export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, PDF_MAGIC)) return 'application/pdf'
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png'
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg'
  return null
}

const EXTENSION: Record<SniffedType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export function extensionForType(type: SniffedType): string {
  return EXTENSION[type]
}
