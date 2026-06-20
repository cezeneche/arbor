// Core 2 — pure share-lifecycle logic. No DB, no side effects. A share is
// viewable only while active; revoked or expired shares must reveal no data.

export type ShareState = 'active' | 'revoked' | 'expired'

export interface ShareLifecycle {
  revokedAt?: Date | string | null
  expiresAt?: Date | string | null
}

function toTime(d: Date | string | null | undefined): number | null {
  if (d === null || d === undefined) return null
  const t = d instanceof Date ? d.getTime() : Date.parse(d)
  return isNaN(t) ? null : t
}

export function shareState(share: ShareLifecycle, now: Date = new Date()): ShareState {
  if (share.revokedAt != null) return 'revoked'
  const expiry = toTime(share.expiresAt)
  if (expiry !== null && expiry <= now.getTime()) return 'expired'
  return 'active'
}

export function isShareViewable(share: ShareLifecycle, now: Date = new Date()): boolean {
  return shareState(share, now) === 'active'
}
