import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { EMAIL_FROM } from '@/lib/email/config'
import type { NotificationType, Prisma } from '@prisma/client'

export type { NotificationType }

// Typed payload per notification event — callers get compile-time enforcement.
export interface NotificationPayloads {
  DATA_REQUEST_RECEIVED: {
    requestId: string
    buyerName: string
    domain: string
    periodStart: string
    periodEnd: string
  }
  DATA_REQUEST_RESPONDED: {
    requestId: string
    supplierEntityId: string
  }
  EXTRACTION_COMPLETE: {
    documentId: string
    documentType: string
    tier: string
    flagCount: number
    criticalCount: number
  }
  FLAG_RAISED: {
    fieldName: string
    message: string
  }
  TIER_UPGRADED: {
    recordId: string
    domain: string
  }
  ACCESS_GRANTED: {
    grantId: string
    grantorEntityId: string
  }
  ACCESS_REVOKED: {
    grantId: string
    grantorEntityId: string
  }
  CERTIFICATE_EXPIRING: {
    count: number
    soonest: string // plain English, e.g. "ISO 14001 certificate expires in 25 days"
  }
  CERTIFICATE_EXPIRED: {
    count: number
    detail: string
  }
  RECORD_SUPERSEDED: {
    supplierName: string
    domain: string
    periodStart: string
    periodEnd: string
  }
  REVIEW_DIGEST: {
    fieldCount: number
    estimatedMinutes: number
    documentCount: number
  }
}

export type NotificationInput<T extends NotificationType = NotificationType> = {
  entityId: string
  type: T
  payload: NotificationPayloads[T]
}

// Lazily instantiated so importing this module (e.g. during `next build` page
// data collection) never requires RESEND_API_KEY. Returns null when no key is
// configured — email delivery is non-fatal, so notifications still persist.
let _resend: Resend | null = null
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (!_resend) _resend = new Resend(apiKey)
  return _resend
}

export async function sendNotification<T extends NotificationType>(
  input: NotificationInput<T>,
): Promise<void> {
  // DB write is non-optional — a failure here is a real error, not swallowed.
  await prisma.notification.create({
    data: {
      entityId: input.entityId,
      type: input.type,
      payload: input.payload as unknown as Prisma.InputJsonValue,
    },
  })

  const users = await prisma.user.findMany({
    where: { entityId: input.entityId, role: { not: 'SYSTEM' } },
    select: { email: true, name: true },
  })

  if (users.length === 0) return

  // No email provider configured — the DB notification is already written.
  const resend = getResend()
  if (!resend) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const subject = notificationSubject(input.type, input.payload as NotificationPayloads[NotificationType])
  const html = notificationHtml(input.type, input.payload as NotificationPayloads[NotificationType], appUrl)

  // Email delivery failures are non-fatal — but they MUST be visible in logs.
  // Resend reports most failures (e.g. sandbox sender restrictions) in the
  // resolved result's `error`, not as a rejection, so check both.
  const results = await Promise.allSettled(
    users.map((u) =>
      resend.emails.send({
        from: EMAIL_FROM,
        to: u.email,
        subject,
        html,
      }),
    ),
  )
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[notifications] send to ${users[i].email} threw:`, r.reason)
    } else if (r.value.error) {
      console.error(`[notifications] send to ${users[i].email} failed:`, r.value.error)
    }
  })
}

function notificationSubject(type: NotificationType, payload: NotificationPayloads[NotificationType]): string {
  switch (type) {
    case 'DATA_REQUEST_RECEIVED':
      return `Data request from ${(payload as NotificationPayloads['DATA_REQUEST_RECEIVED']).buyerName}`
    case 'DATA_REQUEST_RESPONDED':
      return `Supplier responded to your data request`
    case 'EXTRACTION_COMPLETE':
      return `Extraction complete — ${(payload as NotificationPayloads['EXTRACTION_COMPLETE']).documentType}`
    case 'FLAG_RAISED':
      return `Validation flag raised on your data`
    case 'TIER_UPGRADED':
      return `Data record upgraded to Verified`
    case 'ACCESS_GRANTED':
      return `Data access granted`
    case 'ACCESS_REVOKED':
      return `Data access revoked`
    case 'CERTIFICATE_EXPIRING':
      return `Some of your records are expiring soon`
    case 'CERTIFICATE_EXPIRED':
      return `Some of your records have expired`
    case 'RECORD_SUPERSEDED':
      return `A supplier record has been updated`
    case 'REVIEW_DIGEST': {
      const p = payload as NotificationPayloads['REVIEW_DIGEST']
      return `${p.fieldCount} value${p.fieldCount === 1 ? '' : 's'} to check — about ${p.estimatedMinutes} min`
    }
    default:
      return `arbor notification`
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function notificationHtml(
  type: NotificationType,
  payload: NotificationPayloads[NotificationType],
  appUrl: string,
): string {
  switch (type) {
    case 'DATA_REQUEST_RECEIVED': {
      const p = payload as NotificationPayloads['DATA_REQUEST_RECEIVED']
      return `<p>Data request from <strong>${escapeHtml(p.buyerName)}</strong>.<br>Domain: ${escapeHtml(p.domain)} | Period: ${escapeHtml(p.periodStart)} – ${escapeHtml(p.periodEnd)}<br><a href="${appUrl}/upload">Log in to view and respond to this request</a></p>`
    }
    case 'DATA_REQUEST_RESPONDED': {
      const p = payload as NotificationPayloads['DATA_REQUEST_RESPONDED']
      return `<p>Your supplier has responded to the data request.<br><a href="${appUrl}/supply-chain">View supply chain data</a></p>`
    }
    case 'EXTRACTION_COMPLETE': {
      const p = payload as NotificationPayloads['EXTRACTION_COMPLETE']
      return `<p>Extraction complete for <strong>${escapeHtml(p.documentType)}</strong>.<br>Trust tier: <strong>${escapeHtml(p.tier)}</strong> | Flags: ${escapeHtml(p.flagCount)} (${escapeHtml(p.criticalCount)} critical)<br><a href="${appUrl}/upload/${escapeHtml(p.documentId)}/review">Review extracted data</a></p>`
    }
    case 'TIER_UPGRADED':
      return `<p>A data record has been upgraded to <strong>Verified</strong>.<br><a href="${appUrl}/records">View records</a></p>`
    case 'FLAG_RAISED':
      return `<p>A validation flag has been raised on your data.<br><a href="${appUrl}/records">Review records</a></p>`
    case 'CERTIFICATE_EXPIRING': {
      const p = payload as NotificationPayloads['CERTIFICATE_EXPIRING']
      return `<p>${escapeHtml(p.soonest)}. Upload a renewal to keep ${p.count > 1 ? 'these records' : 'this record'} Verified.<br><a href="${appUrl}/dashboard">View what needs attention</a></p>`
    }
    case 'CERTIFICATE_EXPIRED': {
      const p = payload as NotificationPayloads['CERTIFICATE_EXPIRED']
      return `<p>${escapeHtml(p.detail)} Upload a renewal to restore Verified status.<br><a href="${appUrl}/dashboard">View what needs attention</a></p>`
    }
    case 'RECORD_SUPERSEDED': {
      const p = payload as NotificationPayloads['RECORD_SUPERSEDED']
      return `<p>A record from <strong>${escapeHtml(p.supplierName)}</strong> for ${escapeHtml(p.domain)}, ${escapeHtml(p.periodStart)} – ${escapeHtml(p.periodEnd)} has been updated. The original is preserved.<br><a href="${appUrl}/supply-chain">Review the updated record</a></p>`
    }
    case 'REVIEW_DIGEST': {
      const p = payload as NotificationPayloads['REVIEW_DIGEST']
      return `<p>You have <strong>${escapeHtml(p.fieldCount)}</strong> value${p.fieldCount === 1 ? '' : 's'} across ${escapeHtml(p.documentCount)} document${p.documentCount === 1 ? '' : 's'} waiting to be checked — about ${escapeHtml(p.estimatedMinutes)} minutes of work. Nothing else needs your attention.<br><a href="${appUrl}/review">Open your review list</a></p>`
    }
    default:
      return `<p><a href="${appUrl}">Log in to arbor</a></p>`
  }
}
