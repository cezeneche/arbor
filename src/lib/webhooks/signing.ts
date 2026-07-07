// webhook payload signing. Pure crypto helpers; the subscriber's
// signing secret is generated here and only its hash is stored.
import { createHmac, randomBytes } from 'crypto'

export function signWebhookPayload(secret: string, payload: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
}

export function generateWebhookSecret(): string {
  return 'whsec_' + randomBytes(24).toString('hex')
}
