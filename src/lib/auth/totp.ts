import { generateSecret, verifySync, generateURI } from 'otplib'
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getEncryptionKey(): Buffer {
  const hex = process.env.TOTP_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('TOTP_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function generateTotpSecret(): string {
  return generateSecret()
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const result = verifySync({ token: code, secret })
    return result.valid === true
  } catch {
    return false
  }
}

export function getTotpUri(secret: string, email: string, issuer = 'Arbor'): string {
  return generateURI({ label: email, issuer, secret })
}

export function encryptTotpSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
}

export function decryptTotpSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format')
  const [ivB64, tagB64, dataB64] = parts
  const key = getEncryptionKey()
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(data).toString('utf8') + decipher.final('utf8')
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const a = randomBytes(4).toString('hex')
    const b = randomBytes(4).toString('hex')
    return `${a}-${b}`
  })
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase()).digest('hex')
}

export function verifyRecoveryCode(storedHash: string, inputCode: string): boolean {
  return hashRecoveryCode(inputCode) === storedHash
}
