// Gap 6/9 — AES-256-GCM encryption for secrets that must be recovered later:
// webhook signing secrets and third-party integration credentials. The key is
// INTEGRATION_ENCRYPTION_KEY (32 bytes, base64-encoded). Format of the stored
// string: base64(iv).base64(authTag).base64(ciphertext).
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY environment variable is not set')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  return buf
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}
