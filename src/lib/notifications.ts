import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
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
}

export type NotificationInput<T extends NotificationType = NotificationType> = {
  entityId: string
  type: T
  payload: NotificationPayloads[T]
}

const resend = new Resend(process.env.RESEND_API_KEY)

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const subject = notificationSubject(input.type, input.payload as NotificationPayloads[NotificationType])
  const html = notificationHtml(input.type, input.payload as NotificationPayloads[NotificationType], appUrl)

  // Email delivery failures are non-fatal — logged but do not throw.
  await Promise.allSettled(
    users.map((u) =>
      resend.emails.send({
        from: 'arbor <onboarding@resend.dev>',
        to: u.email,
        subject,
        html,
      }),
    ),
  )
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
    default:
      return `<p><a href="${appUrl}">Log in to arbor</a></p>`
  }
}
