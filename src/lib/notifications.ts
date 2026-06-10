import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

type NotificationType =
  | 'DATA_REQUEST_RECEIVED'
  | 'DATA_REQUEST_RESPONDED'
  | 'EXTRACTION_COMPLETE'
  | 'FLAG_RAISED'
  | 'TIER_UPGRADED'
  | 'ACCESS_GRANTED'
  | 'ACCESS_REVOKED'

const resend = new Resend(process.env.RESEND_API_KEY)

interface NotificationInput {
  entityId: string
  type: NotificationType
  payload: Record<string, unknown>
}

export async function sendNotification(input: NotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      entityId: input.entityId,
      type: input.type,
      payload: input.payload as unknown as Prisma.InputJsonValue,
    },
  })

  const users = await prisma.user.findMany({
    where: { entityId: input.entityId },
    select: { email: true, name: true },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const subject = notificationSubject(input.type, input.payload)
  const html = notificationHtml(input.type, input.payload, appUrl)

  await Promise.allSettled(
    users.map((u) =>
      resend.emails.send({
        from: 'Arbor <onboarding@resend.dev>',
        to: u.email,
        subject,
        html,
      }),
    ),
  )
}

function notificationSubject(type: NotificationType, payload: Record<string, unknown>): string {
  switch (type) {
    case 'DATA_REQUEST_RECEIVED':
      return `Data request from ${payload.buyerName}`
    case 'DATA_REQUEST_RESPONDED':
      return `Supplier responded to your data request`
    case 'EXTRACTION_COMPLETE':
      return `Extraction complete  -  ${payload.documentType}`
    case 'FLAG_RAISED':
      return `Validation flag raised on your data`
    case 'TIER_UPGRADED':
      return `Data record upgraded to Tier A`
    case 'ACCESS_GRANTED':
      return `Data access granted`
    case 'ACCESS_REVOKED':
      return `Data access revoked`
    default:
      return `Arbor notification`
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
  payload: Record<string, unknown>,
  appUrl: string,
): string {
  switch (type) {
    case 'DATA_REQUEST_RECEIVED':
      return `<p>Data request from <strong>${escapeHtml(payload.buyerName)}</strong>.<br>Domain: ${escapeHtml(payload.domain)} | Period: ${escapeHtml(payload.periodStart)} – ${escapeHtml(payload.periodEnd)}<br><a href="${appUrl}/requests/${escapeHtml(payload.requestId)}">View request</a></p>`
    case 'EXTRACTION_COMPLETE':
      return `<p>Extraction complete for <strong>${escapeHtml(payload.documentType)}</strong>.<br>Trust tier: <strong>${escapeHtml(payload.tier)}</strong> | Flags: ${escapeHtml(payload.flagCount)} (${escapeHtml(payload.criticalCount)} critical)<br><a href="${appUrl}/upload/${escapeHtml(payload.documentId)}/review">Review extracted data</a></p>`
    case 'TIER_UPGRADED':
      return `<p>A data record has been upgraded to <strong>Tier A</strong>.<br><a href="${appUrl}/records">View records</a></p>`
    case 'FLAG_RAISED':
      return `<p>A validation flag has been raised on your data.<br><a href="${appUrl}/records">Review records</a></p>`
    default:
      return `<p><a href="${appUrl}">Log in to Arbor</a></p>`
  }
}
